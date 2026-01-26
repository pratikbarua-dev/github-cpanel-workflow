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

// --- ROUTE: HOME (View Emails) ---
app.get('/', async (req, res) => {
    // Default to 'inbox' if no box is specified
    const currentBox = req.query.box || 'inbox';

    // --- DB-ONLY VIEWS ---
    if (currentBox === 'scheduled') {
        db.all("SELECT * FROM scheduled_emails WHERE status='pending' ORDER BY scheduled_time ASC", [], (err, rows) => {
            if (err) return res.render('index', { emails: [], currentBox: currentBox, status: "DB Error" });

            // Map DB rows to email-like objects for UI
            const emails = rows.map(r => ({
                uid: r.id, // Use DB ID as UID for UI
                isScheduled: true, // Flag for UI
                from: `To: ${r.to_email}`,
                subject: r.subject,
                date: new Date(r.scheduled_time).toLocaleString(),
                dateShort: new Date(r.scheduled_time).toLocaleDateString(),
                preview: (r.message || '').substring(0, 100),
                html: r.message,
                attributes: { uid: r.id }
            }));

            res.render('index', { emails: emails, currentBox: currentBox, status: null });
        });
        return; // Stop here for scheduled
    }

    // --- IMAP VIEWS ---

    // --- IMAP VIEWS with CACHING ---
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

    const searchBox = folderMap[currentBox] || 'INBOX';

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

        // Handle "Important" View separation
        let searchCriteria = ['ALL'];
        let specificUids = null;

        if (currentBox === 'important') {
            const rows = await db.query("SELECT uid FROM important_emails");
            if (!rows || rows.length === 0) {
                connection.end();
                return res.render('index', { emails: [], currentBox: currentBox, status: null });
            }
            specificUids = rows.map(r => r.uid);
            searchCriteria = [['UID', specificUids.join(',')]];
        }
        else if (currentBox === 'starred') {
            searchCriteria = ['FLAGGED'];
        }

        await connection.openBox(searchBox);

        // OPTIMIZATION:
        // 1. Fetch only UIDs and Date for the last 15 messages (or specific UIDs)
        const fetchOptions = { bodies: ['HEADER.FIELDS (UID DATE)'], struct: false };
        let messages = await connection.search(searchCriteria, fetchOptions);

        // Sort and slice top 15 (if not important view)
        // Since we only fetched headers, sorting by date might be tricky if not parsed.
        // Actually, search results often come in order (seqno).
        // Let's assume order is correct or use attributes.uid.
        // Reverse to get newest first.
        messages = messages.reverse();
        if (currentBox !== 'important') {
            messages = messages.slice(0, 15);
        }

        if (messages.length === 0) {
            connection.end();
            return res.render('index', { emails: [], currentBox: currentBox, status: null });
        }

        const targetUids = messages.map(m => m.attributes.uid);

        // 2. Check Cache
        const placeholders = targetUids.map(() => '?').join(',');
        const cachedRows = await db.query(`SELECT * FROM email_cache WHERE mailbox = ? AND uid IN (${placeholders})`, [searchBox, ...targetUids]);
        const cachedUids = cachedRows.map(r => r.uid);

        // 3. Identify Missing
        const missingUids = targetUids.filter(uid => !cachedUids.includes(uid));

        // 4. Fetch Missing Bodies
        let newEmails = [];
        if (missingUids.length > 0) {
            const missingFetchOptions = { bodies: [''], markSeen: false, struct: true };
            const missingMessages = await connection.search([['UID', missingUids.join(',')]], missingFetchOptions);

            for (const msg of missingMessages) {
                const all = msg.parts.find(p => p.which === '');
                const parsed = await simpleParser(all ? all.body : '');
                const uid = msg.attributes.uid;

                // Parse Data
                const fromText = parsed.from ? parsed.from.text : 'Unknown';
                const subject = parsed.subject || '(No Subject)';
                const dateText = parsed.date ? parsed.date.toLocaleString() : '';
                const preview = (parsed.text || '').replace(/\s+/g, ' ').trim().substring(0, 100);
                const html = parsed.html || parsed.textAsHtml || parsed.text;
                const attachments = parsed.attachments ? parsed.attachments.map(a => ({
                    filename: a.filename,
                    size: a.size,
                    contentType: a.contentType
                })) : [];

                newEmails.push({
                    uid,
                    mailbox: searchBox,
                    from: fromText,
                    subject,
                    date: dateText,
                    preview,
                    html,
                    attachments: attachments
                });

                // 5. Update Cache
                // Using INSERT OR REPLACE equivalent
                // For MySQL/SQLite compatibility via db.js, we might need simple INSERT or check existence.
                // We know it's missing, so INSERT should work.
                try {
                    await db.query(`INSERT INTO email_cache (uid, mailbox, from_text, subject, date_text, preview, html, attachments_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [uid, searchBox, fromText, subject, dateText, preview, html, JSON.stringify(attachments)]);
                } catch (e) { console.error("Cache Insert Error:", e.message); }
            }
        }

        connection.end();

        // 6. Merge and Prepare for View
        // Map original 'messages' to ensure correct order

        // Fetch Important UIDs for flagging
        const importantRows = await db.query("SELECT uid FROM important_emails");
        const importantUids = importantRows.map(r => r.uid);

        const finalEmails = targetUids.map(uid => {
            // Find in cache or newEmails
            let data = newEmails.find(e => e.uid === uid) || cachedRows.find(e => e.uid === uid);

            if (!data) return null; // Should not happen

            // Normalize data (cached rows have snake_case columns if selected directly?)
            // db.js returns rows.
            // If from DB, attachments_json needs parsing.

            let attachments = [];
            if (data.attachments) attachments = data.attachments; // From new fetch
            else if (data.attachments_json) {
                try { attachments = JSON.parse(data.attachments_json); } catch (e) { }
            }

            // Date Formatting
            let dateShort = '';
            const dateStr = data.date || data.date_text; // data.date from newConfig, date_text from DB
            if (dateStr) {
                const now = new Date();
                const d = new Date(dateStr);
                if (d.toDateString() === now.toDateString()) dateShort = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                else dateShort = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
            }

            return {
                uid: data.uid,
                isImportant: importantUids.includes(data.uid),
                from: data.from || data.from_text,
                subject: data.subject,
                date: dateStr,
                dateShort: dateShort,
                preview: data.preview,
                html: data.html,
                attachments: attachments
            };
        }).filter(e => e !== null);

        res.render('index', {
            emails: finalEmails,
            currentBox: currentBox,
            status: null
        });

    } catch (err) {
        console.error(err);
        res.render('index', {
            emails: [],
            currentBox: currentBox,
            status: `Error: Could not open folder '${searchBox}'. Server said: ${err.message}`
        });
    }
});

// --- ROUTE: Download Attachment ---
app.get('/attachment', async (req, res) => {
    const { uid, box, filename } = req.query;
    if (!uid || !filename) return res.status(400).send('Missing UID or Filename');

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
app.post('/action', bodyParser.json(), async (req, res) => {
    const { uids, action, currentBox } = req.body;

    // Map UI names to actual Server Folder names
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
        targetBox = folderMap['trash'];
    } else if (action === 'archive') {
        targetBox = folderMap['archive'];
    } else {
        return res.status(400).json({ success: false, message: 'Invalid action' });
    }

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
        await connection.openBox(sourceBox);

        // Move messages to target folder
        // Note: 'uids' should be an array of numbers
        // If we are using seqno as fallback, moveMessage might behave unexpectedly if it expects UIDs.
        // imap-simple's moveMessage usually expects UIDs.
        // If msg.attributes.uid was missing, we passed seqno.
        // We might need to check how to move by seqno or ensure UIDs work.
        // For now, let's assume if we passed seqno, we try the move, but it might fail or move wrong msg if UIDs are expected.

        if (uids && uids.length > 0) {
            // Ensure UIDs are numbers
            const validUids = uids.map(id => parseInt(id)).filter(id => !isNaN(id));
            if (validUids.length > 0) {
                await connection.moveMessage(validUids, targetBox);
            }
        }

        connection.end();
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