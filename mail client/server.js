const express = require('express');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const multer = require('multer');
const fs = require('fs');
const cron = require('node-cron');
const db = require('./db'); // Abstraction

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// --- DATABASE INIT ---
// Initialize table structure
db.init();

// --- CRON JOBS ---
// Check for scheduled emails every minute
cron.schedule('* * * * *', async () => {
    console.log('Running Cron: Checking scheduled & snoozed tasks...');

    // 1. Process Scheduled Emails
    try {
        const rows = await db.query("SELECT * FROM scheduled_emails WHERE status='pending' AND scheduled_time <= ?", [Date.now()]);

        if (rows && rows.length > 0) {
            for (const row of rows) {
                try {
                    let transporter = nodemailer.createTransport({
                        host: HOST,
                        port: 465,
                        secure: true,
                        auth: { user: EMAIL_USER, pass: EMAIL_PASS },
                        tls: { rejectUnauthorized: false }
                    });

                    await transporter.sendMail({
                        from: EMAIL_USER,
                        to: row.to_email,
                        subject: row.subject,
                        html: row.message
                    });

                    // Update status to sent
                    await db.query("UPDATE scheduled_emails SET status='sent' WHERE id=?", [row.id]);
                    console.log(`Scheduled email ${row.id} sent.`);

                } catch (e) {
                    console.error(`Failed to send scheduled email ${row.id}:`, e);
                    await db.query("UPDATE scheduled_emails SET status='failed' WHERE id=?", [row.id]);
                }
            }
        }
    } catch (err) { console.error("Cron Scheduled Error:", err); }

    // 2. Process Snoozed Emails (Move back to Inbox)
    try {
        const rows = await db.query("SELECT * FROM snoozed_emails WHERE status='active' AND snooze_until <= ?", [Date.now()]);

        if (rows && rows.length > 0) {
            try {
                const config = {
                    imap: {
                        user: EMAIL_USER,
                        password: EMAIL_PASS,
                        host: HOST,
                        port: 993,
                        tls: true,
                        authTimeout: 10000,
                        tlsOptions: { rejectUnauthorized: false }
                    }
                };
                const connection = await imaps.connect(config);
                await connection.openBox('INBOX.Snoozed');

                for (const row of rows) {
                    // Search by Message-ID since UID invalid
                    if (row.message_id) {
                        try {
                            const searchCriteria = [['HEADER', 'MESSAGE-ID', row.message_id]];
                            const fetchOptions = { bodies: [''], markSeen: false };
                            const messages = await connection.search(searchCriteria, fetchOptions);

                            if (messages.length > 0) {
                                // Move it back
                                const foundUid = messages[0].attributes.uid;
                                await connection.moveMessage([foundUid], row.original_box || 'INBOX');
                                await db.query("DELETE FROM snoozed_emails WHERE id=?", [row.id]);
                                console.log(`Snoozed email ${row.message_id} restored to Inbox.`);
                            } else {
                                console.log(`Snoozed email ${row.message_id} not found in Snoozed box.`);
                            }
                        } catch (searchErr) {
                            console.error("Failed to restore snoozed msg:", searchErr);
                        }
                    }
                }
                connection.end();
            } catch (connErr) {
                console.error("IMAP Cron connection error:", connErr);
            }
        }
    } catch (err) { console.error("Cron Snooze Error:", err); }
});


app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// --- CONFIGURATION ---
const EMAIL_USER = 'admin@morphbangladesh.org';
const EMAIL_PASS = 'Dm6:7tPZis56';
const HOST = 's1.sitechai.com';

const MailSyncService = require('../src/services/mailSync');

// --- HELPER: Fetch Email Data ---
async function fetchViewData(box, searchQuery) {
    const folderMap = {
        'inbox': 'INBOX',
        'sent': 'INBOX.Sent',
        'drafts': 'INBOX.Drafts',
        'trash': 'INBOX.Trash',
        'spam': 'INBOX.Junk',
        'starred': 'INBOX', // We filter later? No, currently mapped to INBOX
        'archive': 'INBOX.Archive',
        'snoozed': 'INBOX.Snoozed',
        'important': 'INBOX'
    };

    // Safety
    box = box || 'inbox';
    const dbMailbox = folderMap[box] || 'INBOX';
    const emails = [];

    // Scheduled is special table
    if (box === 'scheduled') {
        const rows = await db.query("SELECT * FROM scheduled_emails WHERE status='pending' ORDER BY scheduled_time ASC");
        return rows.map(r => ({
            uid: r.id,
            isScheduled: true,
            from: `To: ${r.to_email}`,
            subject: r.subject,
            date: new Date(r.scheduled_time).toLocaleString(),
            dateShort: new Date(r.scheduled_time).toLocaleDateString(),
            preview: (r.message || '').substring(0, 100),
            html: r.message,
            attributes: { uid: r.id }
        }));
    }

    // Normal Tables
    let sql = `SELECT * FROM email_cache WHERE mailbox = ?`;
    let params = [dbMailbox];

    if (searchQuery) {
        sql += ` AND (subject LIKE ? OR from_text LIKE ? OR preview LIKE ?)`;
        const wild = `%${searchQuery}%`;
        params.push(wild, wild, wild);
    }

    sql += ` ORDER BY date_text DESC, uid DESC LIMIT 50`;

    const rows = await db.query(sql, params);

    return rows.map(r => {
        let attachments = [];
        if (r.attachments_json) {
            try { attachments = JSON.parse(r.attachments_json); } catch (e) { }
        }

        // Date Formatting
        let dateShort = '';
        const dateStr = r.date_text;
        if (dateStr) {
            const now = new Date();
            const d = new Date(dateStr);
            if (d.toString() !== 'Invalid Date') {
                if (d.toDateString() === now.toDateString()) dateShort = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                else dateShort = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
            } else {
                dateShort = dateStr.substring(0, 10);
            }
        }

        return {
            uid: r.uid,
            mailbox: r.mailbox,
            accountId: r.account_id,
            isImportant: false, // Join?
            from: r.from_text,
            subject: r.subject,
            date: r.date_text,
            dateShort: dateShort,
            preview: r.preview,
            html: r.html,
            attachments: attachments
        };
    });
}

// --- ROUTE: HOME (View Emails) ---
app.get('/', async (req, res) => {
    const currentBox = req.query.box || 'inbox';
    const search = req.query.search || '';

    // Init DB (non-blocking, okay to fire and forget or it's fast)
    // accId logic moved to getAccountId

    try {
        const emails = await fetchViewData(currentBox, search);
        res.render('mail/index', { emails: emails, currentBox: currentBox, status: null, searchQuery: search });
    } catch (err) {
        console.error(err);
        res.render('mail/index', { emails: [], currentBox: currentBox, status: `DB Error: ${err.message}`, searchQuery: search });
    }
});

// --- ROUTE: PARTIAL (For AJAX) ---
// --- ROUTE: PARTIAL (For AJAX) ---
app.get('/partial', async (req, res) => {
    const currentBox = req.query.box || 'inbox';
    const search = req.query.search || '';

    try {
        // Pure DB call - NO network connection should happen here
        const emails = await fetchViewData(currentBox, search);

        // Render ONLY the content part
        res.render('mail/content', { emails: emails, currentBox: currentBox, searchQuery: search }, (err, html) => {
            if (err) {
                console.error("[MailClient] Template Render Error:", err);
                return res.status(500).send("Template Error: " + err.message);
            }
            res.send(html);
        });
    } catch (err) {
        console.error("[MailClient] DB Error in /partial:", err);
        res.status(500).send("Database Error: " + err.message);
    }
});

// --- API: Manual Sync ---
app.get('/api/sync', async (req, res) => {
    try {
        const syncService = new MailSyncService({
            user: EMAIL_USER,
            password: EMAIL_PASS,
            host: HOST,
            tls: true
        });
        await syncService.syncAll();
        res.json({ success: true, message: 'Sync completed' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// --- ROUTE: Download Attachment ---
app.get('/attachment', async (req, res) => {
    const { uid, box, filename } = req.query;
    if (!uid || !filename) return res.status(400).send('Missing UID or Filename');

    // ... (Keep existing attachment logic, or use DB if we stored content?)
    // We didn't store content. So this MUST use IMAP.
    // Copy existing logic:
    const folderMap = {
        'inbox': 'INBOX',
        'sent': 'INBOX.Sent',
        'drafts': 'INBOX.Drafts',
        'trash': 'INBOX.Trash',
        'spam': 'INBOX.Junk',
        'starred': 'INBOX',
        'archive': 'INBOX.Archive',
        'snoozed': 'INBOX.Snoozed',
        'important': 'INBOX'
    };
    const searchBox = folderMap[box] || 'INBOX';

    try {
        const config = {
            imap: {
                user: EMAIL_USER,
                password: EMAIL_PASS,
                host: HOST,
                port: 993,
                tls: true,
                authTimeout: 10000,
                tlsOptions: { rejectUnauthorized: false }
            }
        };
        const connection = await imaps.connect(config);
        await connection.openBox(searchBox);

        const fetchOptions = { bodies: [''], markSeen: false, struct: true };
        const messages = await connection.search([['UID', uid]], fetchOptions);

        if (messages.length === 0) {
            connection.end();
            return res.status(404).send('Email not found');
        }

        const all = messages[0].parts.find(p => p.which === '');
        const parsed = await simpleParser(all ? all.body : '');

        connection.end();

        const attachment = parsed.attachments.find(a => a.filename === filename);
        if (attachment) {
            res.setHeader('Content-Type', attachment.contentType);
            res.setHeader('Content-Disposition', `attachment; filename="${attachment.filename}"`);
            res.send(attachment.content);
        } else {
            res.status(404).send('Attachment not found');
        }

    } catch (err) {
        console.error('Download Error:', err);
        res.status(500).send('Server Error');
    }
});

// --- ROUTE: HANDLE ACTIONS (Delete/Archive) ---
// --- ROUTE: HANDLE ACTIONS (Delete/Archive) ---
app.post('/action', bodyParser.json(), async (req, res) => {
    const { uids, action, currentBox, accountId } = req.body;
    // accountId optional for backward compat? 
    // If we have mixed views, frontend MUST pass accountId for the specific email.
    // If uids is array, we assume all belong to same account? 
    // Normally frontend sends batch actions.

    const folderMap = {
        'inbox': 'INBOX',
        'sent': 'INBOX.Sent',
        'drafts': 'INBOX.Drafts',
        'trash': 'INBOX.Trash',
        'spam': 'INBOX.Junk',
        'starred': 'INBOX',
        'archive': 'INBOX.Archive'
    };

    const sourceBox = folderMap[currentBox] || 'INBOX';
    let targetBox;

    if (action === 'delete') {
        targetBox = folderMap['trash']; // Or 'Trash'
    } else if (action === 'archive') {
        targetBox = folderMap['archive'];
    } else {
        return res.status(400).json({ success: false, message: 'Invalid action' });
    }

    const currentAccId = db.getAccountId(EMAIL_USER, HOST);
    const isOfflineAction = accountId && accountId !== currentAccId;

    try {
        if (!isOfflineAction) {
            // Online Action: Move on Real Server + Update DB
            const config = {
                imap: {
                    user: EMAIL_USER,
                    password: EMAIL_PASS,
                    host: HOST,
                    port: 993,
                    tls: true,
                    authTimeout: 10000,
                    tlsOptions: { rejectUnauthorized: false }
                }
            };

            const connection = await imaps.connect(config);
            await connection.openBox(sourceBox);

            if (uids && uids.length > 0) {
                const validUids = uids.map(id => parseInt(id)).filter(id => !isNaN(id));
                if (validUids.length > 0) {
                    await connection.moveMessage(validUids, targetBox);
                }
            }
            connection.end();
            // Now update DB to match
            if (action === 'delete') {
                // Actually move in DB or delete?
                // Trash is a box. So UPDARE mailbox.
                await db.query("UPDATE email_cache SET mailbox=? WHERE uid IN (" + uids.join(',') + ") AND account_id=?",
                    [targetBox, currentAccId]);
            } else {
                await db.query("UPDATE email_cache SET mailbox=? WHERE uid IN (" + uids.join(',') + ") AND account_id=?",
                    [targetBox, currentAccId]);
            }
        } else {
            // Offline Action (Legacy/Migrated): Only Update DB
            console.log(`[MailAction] Performing offline action on account ${accountId}`);
            if (action === 'delete') {
                await db.query("UPDATE email_cache SET mailbox=? WHERE uid IN (" + uids.join(',') + ") AND account_id=?",
                    [targetBox, accountId]);
            } else {
                await db.query("UPDATE email_cache SET mailbox=? WHERE uid IN (" + uids.join(',') + ") AND account_id=?",
                    [targetBox, accountId]);
            }
        }

        res.json({ success: true });

    } catch (err) {
        console.error("Action Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- ROUTE: SEND EMAIL ---
app.post('/send', upload.array('attachments'), async (req, res) => {
    const { to, subject, message } = req.body;
    const attachments = req.files.map(file => ({ filename: file.originalname, content: file.buffer }));

    try {
        let transporter = nodemailer.createTransport({
            host: HOST,
            port: 465,
            secure: true,
            auth: { user: EMAIL_USER, pass: EMAIL_PASS },
            tls: { rejectUnauthorized: false }
        });

        await transporter.sendMail({
            from: EMAIL_USER,
            to: to,
            subject: subject,
            html: message,
            attachments: attachments
        });

        res.redirect('/?box=sent'); // Go to sent folder after sending
    } catch (err) {
        res.send("Error: " + err.message);
    }
});

// --- ROUTE: Mark Important ---
app.post('/mark-important', bodyParser.json(), async (req, res) => {
    const { uid, isImportant } = req.body;
    try {
        if (isImportant) {
            await db.query("INSERT INTO important_emails (uid) VALUES (?) ON DUPLICATE KEY UPDATE uid=uid", [uid]);
            // SQLite doesn't support ON DUPLICATE KEY (MySQL syntax).
            // Abstraction layer uses specific SQL? Or generic?
            // SQLite: INSERT OR IGNORE. MySQL: INSERT IGNORE.
            // Let's use INSERT IGNORE style if possible, or Try Catch?
            // Best generic: SELECT first? Or use standard try/catch insert.
            // I'll use simple try catch on INSERT.
            try { await db.query("INSERT INTO important_emails (uid) VALUES (?)", [uid]); } catch (e) { }
        } else {
            await db.query("DELETE FROM important_emails WHERE uid = ?", [uid]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// --- ROUTE: Snooze ---
app.post('/snooze', bodyParser.json(), async (req, res) => {
    const { uids, until } = req.body; // until is timestamp
    // Move to INBOX.Snoozed and save to DB
    try {
        const config = {
            imap: {
                user: EMAIL_USER,
                password: EMAIL_PASS,
                host: HOST,
                port: 993,
                tls: true,
                authTimeout: 10000,
                tlsOptions: { rejectUnauthorized: false }
            }
        };
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');
        try { await connection.addBox('INBOX.Snoozed'); } catch (e) { }

        await connection.moveMessage(uids, 'INBOX.Snoozed');

        // Fetch headers first to get Message-ID
        const fetchOptions = { bodies: ['HEADER.FIELDS (MESSAGE-ID)'], struct: true };
        const messages = await connection.search([['UID', uids.join(',')]], fetchOptions);

        for (const msg of messages) {
            const header = msg.parts[0].body;
            const messageId = header['message-id'] ? header['message-id'][0] : null;
            if (messageId) {
                // Insert into DB with Message-ID
                await db.query("INSERT INTO snoozed_emails (message_id, uid, original_box, snooze_until) VALUES (?, ?, ?, ?)",
                    [messageId, 0, 'INBOX', until]);
            }
        }

        connection.end();
        res.json({ success: true });

    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- ROUTE: Schedule Send ---
app.post('/schedule', bodyParser.json(), async (req, res) => {
    const { to, subject, message, time } = req.body;
    try {
        await db.query("INSERT INTO scheduled_emails (to_email, subject, message, scheduled_time) VALUES (?, ?, ?, ?)",
            [to, subject, message, time]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.listen(3000, () => console.log('Server started on http://localhost:3000'));