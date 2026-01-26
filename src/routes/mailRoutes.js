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

const { ensureAuthenticated } = require('../middleware/auth');

// Configuration from Env
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const HOST = process.env.EMAIL_HOST || process.env.HOST;

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
        user: req.user
    });
});

// --- ROUTE: CONTENT PARTIAL (AJAX) ---
router.get('/partial', async (req, res) => {
    // Default to 'inbox' if no box is specified
    const currentBox = req.query.box || 'inbox';
    const searchQuery = req.query.search || null;

    // --- DB-ONLY VIEWS ---
    if (currentBox === 'scheduled') {
        try {
            let sql = "SELECT * FROM scheduled_emails WHERE status='pending'";
            const params = [];

            if (searchQuery) {
                sql += " AND (subject LIKE ? OR message LIKE ? OR to_email LIKE ?)";
                const term = `%${searchQuery}%`;
                params.push(term, term, term);
            }

            sql += " ORDER BY scheduled_time ASC";

            const rows = await db.query(sql, params);
            const emails = rows.map(r => ({
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
            return res.render('mail/content', { emails: emails, currentBox: currentBox, status: null });
        } catch (err) {
            return res.render('mail/content', { emails: [], currentBox: currentBox, status: "DB Error: " + err.message });
        }
    }

    // --- IMAP VIEWS ---
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

        let searchCriteria = [['ALL']]; // Nested array for imap-simple if mixing
        let specificUids = null;

        if (currentBox === 'important') {
            const rows = await db.query("SELECT uid FROM important_emails");
            if (!rows || rows.length === 0) {
                connection.end();
                return res.render('mail/content', { emails: [], currentBox: currentBox, status: null });
            }
            specificUids = rows.map(r => r.uid);
            searchCriteria = [['UID', specificUids.join(',')]];
        }
        else if (currentBox === 'starred') {
            searchCriteria = [['FLAGGED']];
        } else {
            searchCriteria = ['ALL'];
        }

        // Apply Search
        if (searchQuery) {
            // If we are already filtering by specific UIDs (Important), we can't easily mix 'TEXT' with 'UID' list in one go depending on server caps.
            // But standard IMAP allows: UID x,y,z AND TEXT "foo"
            // imap-simple criteria format: array of strings or sub-arrays.
            // CAUTION: If currentBox is important, searchCriteria is [['UID', ...]]. 
            // We want to ADD ['TEXT', searchQuery] to the criteria list.

            if (Array.isArray(searchCriteria[0]) && searchCriteria[0][0] === 'UID') {
                // It's the UID one. Add to it? Or as separate param?
                // node-imap (underlying) accepts items as varargs or array. 
                // Let's make searchCriteria an array of criteria.
                searchCriteria.push(['TEXT', searchQuery]);
            } else {
                // For 'ALL' or 'FLAGGED'
                // If it was just ['ALL'], we can replace or append.
                searchCriteria = [['TEXT', searchQuery]];
                if (currentBox === 'starred') searchCriteria.push(['FLAGGED']);
            }
        }


        try {
            await connection.openBox(searchBox);
        } catch (boxErr) {
            connection.end();
            return res.render('mail/content', { emails: [], currentBox: currentBox, status: null });
        }

        const fetchOptions = { bodies: ['HEADER.FIELDS (UID DATE)'], struct: false };
        let messages = await connection.search(searchCriteria, fetchOptions);

        messages = messages.reverse();

        if (messages.length === 0) {
            connection.end();
            return res.render('mail/content', { emails: [], currentBox: currentBox, status: null });
        }

        const targetUids = messages.map(m => m.attributes.uid);
        const placeholders = targetUids.map(() => '?').join(',');
        const cachedRows = await db.query(`SELECT * FROM email_cache WHERE mailbox = ? AND uid IN (${placeholders})`, [searchBox, ...targetUids]);
        const cachedUids = cachedRows.map(r => r.uid);
        const missingUids = targetUids.filter(uid => !cachedUids.includes(uid));

        let newEmails = [];
        if (missingUids.length > 0) {
            const missingFetchOptions = { bodies: [''], markSeen: false, struct: true };
            const missingMessages = await connection.search([['UID', missingUids.join(',')]], missingFetchOptions);

            for (const msg of missingMessages) {
                const all = msg.parts.find(p => p.which === '');
                const parsed = await simpleParser(all ? all.body : '');
                const uid = msg.attributes.uid;

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

                newEmails.push({ uid, mailbox: searchBox, from: fromText, subject, date: dateText, preview, html, attachments: attachments });

                try {
                    await db.query(`INSERT INTO email_cache (uid, mailbox, from_text, subject, date_text, preview, html, attachments_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [uid, searchBox, fromText, subject, dateText, preview, html, JSON.stringify(attachments)]);
                } catch (e) { }
            }
        }

        connection.end();

        const importantRows = await db.query("SELECT uid FROM important_emails");
        const importantUids = importantRows.map(r => r.uid);

        const finalEmails = targetUids.map(uid => {
            let data = newEmails.find(e => e.uid === uid) || cachedRows.find(e => e.uid === uid);
            if (!data) return null;
            let attachments = [];
            if (data.attachments) attachments = data.attachments;
            else if (data.attachments_json) {
                try { attachments = JSON.parse(data.attachments_json); } catch (e) { }
            }
            let dateShort = '';
            const dateStr = data.date || data.date_text;
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

        res.render('mail/content', {
            emails: finalEmails,
            currentBox: currentBox,
            status: null
        });

    } catch (err) {
        console.error(err);
        res.render('mail/content', {
            emails: [],
            currentBox: currentBox,
            status: `Error: Could not open folder '${searchBox}'. Server said: ${err.message}`
        });
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
