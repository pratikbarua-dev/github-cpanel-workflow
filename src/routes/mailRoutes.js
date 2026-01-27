const express = require('express');
const router = express.Router();
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const multer = require('multer');
const db = require('../utils/mailDb');
require('dotenv').config();

const upload = multer({ storage: multer.memoryStorage() });
const MailSyncService = require('../services/mailSync');

const { ensureAuthenticated } = require('../middleware/auth');

// Configuration from Env
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const HOST = process.env.EMAIL_HOST || process.env.HOST;

// Debug: Log mail configuration on startup (mask password)
console.log('[MailClient] Configuration Check:');
console.log(`  - ENABLE_MAIL_CLIENT: ${process.env.ENABLE_MAIL_CLIENT || 'NOT SET'}`);
console.log(`  - EMAIL_USER: ${EMAIL_USER ? 'SET (' + EMAIL_USER + ')' : 'NOT SET'}`);
console.log(`  - EMAIL_PASS: ${EMAIL_PASS ? 'SET (hidden)' : 'NOT SET'}`);
console.log(`  - EMAIL_HOST: ${HOST || 'NOT SET'}`);

// Middleware to check if Mail Client is enabled AND Auth
router.use(ensureAuthenticated, (req, res, next) => {
    // Role Check: Admin & Moderator Only
    if (req.user.role !== 'admin' && req.user.role !== 'moderator') {
        return res.status(403).render('admin/error', {
            message: 'Access Restricted',
            reason: 'Only Admins and Moderators can access the Mail Client.',
            error: { status: 403 },
            title: 'Permission Denied',
            user: req.user
        });
    }

    if (!process.env.ENABLE_MAIL_CLIENT || process.env.ENABLE_MAIL_CLIENT !== 'true') {
        return res.render('mail/not_subscribed');
    }
    // Check for Email Config
    if (!EMAIL_USER || !EMAIL_PASS || !HOST) {
        return res.render('mail/index', {
            emails: [],
            currentBox: 'inbox',
            status: 'Error: Email Configuration Missing (EMAIL_USER, EMAIL_PASS, EMAIL_HOST)'
        });
    }
    next();
});

// --- ROUTE: HOME (Shell) ---
router.get('/', (req, res) => {
    // Render the shell immediately. The shell keeps the user provided context.
    res.render('mail/index', {
        title: 'Morph Mail',
        path: '/mail',
        user: req.user,
        layout: false
    });
});

// --- ROUTE: CONTENT PARTIAL (AJAX) ---
// --- HELPER: Fetch Email Data (DB Only) ---
// --- HELPER: Fetch Email Data (DB Only) ---
// --- HELPER: Fetch Email Data (DB Only) ---
async function fetchViewData(box, searchQuery, accountId) {
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

    // Safety
    box = box || 'inbox';
    const dbMailbox = folderMap[box] || 'INBOX';

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
    // If searching, we currently only search the current box.
    // Ideally we might want to search ALL boxes, but UI structure expects currentBox context.
    let sql = `SELECT * FROM email_cache WHERE mailbox = ? AND account_id = ?`;
    let params = [dbMailbox, accountId];

    if (searchQuery) {
        // Search Logic
        sql += ` AND (subject LIKE ? OR from_text LIKE ? OR preview LIKE ?)`;
        const wild = `%${searchQuery}%`;
        params.push(wild, wild, wild);
    }

    // Default Sort: Database UID Descending (approximate time)
    // We fetch a larger limit to allow better in-memory sorting of near ties or if UIDs are out of sync with Date
    sql += ` ORDER BY uid DESC LIMIT 200`;

    const rows = await db.query(sql, params);

    const mapped = rows.map(r => {
        let attachments = [];
        if (r.attachments_json) {
            try { attachments = JSON.parse(r.attachments_json); } catch (e) { }
        }

        // Date Parsing & Formatting
        let dateShort = '';
        const dateStr = r.date_text;
        let dateObj = new Date(0); // Default epoch

        if (dateStr) {
            const now = new Date();
            const d = new Date(dateStr);
            dateObj = d;

            if (d.toString() !== 'Invalid Date') {
                if (d.toDateString() === now.toDateString()) {
                    // Today: 2:30 PM
                    dateShort = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                } else {
                    // Older: Jan 27, 2:30 PM (Showing time is important)
                    dateShort = d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' +
                        d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                }
            } else {
                dateShort = dateStr.substring(0, 10);
            }
        }

        return {
            uid: r.uid,
            mailbox: r.mailbox,
            accountId: r.account_id,
            isImportant: false, // TODO: Join with important_emails
            from: r.from_text,
            subject: r.subject,
            date: r.date_text,
            dateObj: dateObj, // Internal for sorting
            dateShort: dateShort,
            preview: r.preview,
            html: r.html,
            attachments: attachments
        };
    });

    // Sort by Date Descending (Newest first)
    // If dates are equal, fallback to UID
    mapped.sort((a, b) => b.dateObj - a.dateObj || b.uid - a.uid);

    return mapped;
}

// --- ROUTE: CONTENT PARTIAL (AJAX) ---
router.get('/partial', async (req, res) => {
    const currentBox = req.query.box || 'inbox';
    const searchQuery = req.query.search || null;
    const currentAccountId = db.getAccountId(EMAIL_USER, HOST);

    try {
        // Pure DB call - NO network connection
        const emails = await fetchViewData(currentBox, searchQuery, currentAccountId);

        res.render('mail/content', {
            emails: emails,
            currentBox: currentBox,
            status: null,
            layout: false
        });

    } catch (err) {
        console.error("[MailClient] DB Error in /partial:", err);
        res.render('mail/content', {
            emails: [],
            currentBox: currentBox,
            status: "Database Error: " + err.message,
            layout: false
        });
    }
});

// --- ROUTE: MANUAL SYNC (Refresh) ---
router.get('/api/sync', async (req, res) => {
    // Only allow if configured
    if (!EMAIL_USER || !EMAIL_PASS || !HOST) {
        return res.status(500).json({ success: false, message: 'Mail not configured' });
    }

    try {
        const syncService = new MailSyncService({
            user: EMAIL_USER,
            password: EMAIL_PASS,
            host: HOST,
            tls: true
        });

        // Run sync (fire and forget? No, user is waiting)
        await syncService.syncAll();

        res.json({ success: true });
    } catch (err) {
        console.error("Manual Sync Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- ROUTE: Download Attachment ---
router.get('/attachment', async (req, res) => {
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

    // Optimization: Try to serve from cache if stored? 
    // Currently cache only stores metadata. 
    // We must fetch from IMAP.

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
router.post('/action', bodyParser.json(), async (req, res) => {
    const { uids, action, currentBox } = req.body;

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

        if (uids && uids.length > 0) {
            const validUids = uids.map(id => parseInt(id)).filter(id => !isNaN(id));
            if (validUids.length > 0) {
                await connection.moveMessage(validUids, targetBox);
            }
        }

        connection.end();

        // --- UPDATE DATABASE ---
        const currentAccId = db.getAccountId(EMAIL_USER, HOST);
        if (uids && uids.length > 0) {
            const validUids = uids.map(id => parseInt(id)).filter(id => !isNaN(id));
            // We must update the mailbox for these UIDs
            const placeholders = validUids.map(() => '?').join(',');
            // Need to spread the array for params
            await db.query(`UPDATE email_cache SET mailbox = ? WHERE account_id = ? AND uid IN (${placeholders})`,
                [targetBox, currentAccId, ...validUids]);
        }

        res.json({ success: true });

    } catch (err) {
        console.error("Action Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- ROUTE: SEND EMAIL ---
router.post('/send', upload.array('attachments'), async (req, res) => {
    const { to, subject, message } = req.body;
    let attachments = [];
    if (req.files) {
        attachments = req.files.map(file => ({ filename: file.originalname, content: file.buffer }));
    }

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

        res.redirect('/mail/?box=sent');
    } catch (err) {
        res.send("Error: " + err.message);
    }
});

// --- ROUTE: Mark Important ---
router.post('/mark-important', bodyParser.json(), async (req, res) => {
    const { uid, isImportant } = req.body;
    try {
        if (isImportant) {
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
router.post('/snooze', bodyParser.json(), async (req, res) => {
    const { uids, until } = req.body; // until is timestamp
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

        // Ensure UIDs valid
        const validUids = uids.map(id => parseInt(id)).filter(id => !isNaN(id));

        if (validUids.length > 0) {

            // Fetch headers first to get Message-ID for each UID
            const fetchOptions = { bodies: ['HEADER.FIELDS (MESSAGE-ID)'], struct: true };
            const messages = await connection.search([['UID', validUids.join(',')]], fetchOptions);

            for (const msg of messages) {
                const header = msg.parts[0].body;
                const messageId = header['message-id'] ? header['message-id'][0] : null;
                const uid = msg.attributes.uid;

                if (messageId) {
                    // Insert into DB with Message-ID
                    await db.query("INSERT INTO snoozed_emails (message_id, uid, original_box, snooze_until) VALUES (?, ?, ?, ?)",
                        [messageId, uid, 'INBOX', until]);
                }
            }

            await connection.moveMessage(validUids, 'INBOX.Snoozed');
        }

        connection.end();
        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- ROUTE: Schedule Send ---
router.post('/schedule', bodyParser.json(), async (req, res) => {
    const { to, subject, message, time } = req.body;
    try {
        const user = 'admin'; // Determine user if multi-user auth implemented
        await db.query("INSERT INTO scheduled_emails (user, to_email, subject, message, scheduled_time) VALUES (?, ?, ?, ?, ?)",
            [user, to, subject, message, time]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
