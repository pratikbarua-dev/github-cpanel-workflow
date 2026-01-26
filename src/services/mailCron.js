const cron = require('node-cron');
const nodemailer = require('nodemailer');
const imaps = require('imap-simple');
const db = require('../utils/mailDb');
require('dotenv').config();

// Configuration
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const HOST = process.env.EMAIL_HOST || process.env.HOST;

function init() {
    if (!process.env.ENABLE_MAIL_CLIENT || process.env.ENABLE_MAIL_CLIENT !== 'true') {
        console.log('[MailCron] Mail Client disabled. Skipping Cron init.');
        return;
    }

    // Ensure DB is init (it might already be called in app.js, but safe to call again if idempotent)
    // Actually app.js calls db.init(), so we assume tables exist.

    console.log('[MailCron] Initializing Cron Jobs...');

    // Check for scheduled emails every minute
    cron.schedule('* * * * *', async () => {
        // console.log('[MailCron] Running Cron: Checking scheduled & snoozed tasks...');

        if (!EMAIL_USER || !EMAIL_PASS || !HOST) {
            // console.warn('[MailCron] Missing Email Config. Skipping cycle.');
            return;
        }

        // 1. Process Scheduled Emails
        try {
            const rows = await db.query("SELECT * FROM scheduled_emails WHERE status='pending' AND scheduled_time <= ?", [Date.now()]);

            if (rows && rows.length > 0) {
                for (const row of rows) {
                    try {
                        let transporter = nodemailer.createTransport({
                            host: HOST,
                            port: 465, // Assume secure for now, can be env logic
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
                        console.log(`[MailCron] Scheduled email ${row.id} sent.`);

                    } catch (e) {
                        console.error(`[MailCron] Failed to send scheduled email ${row.id}:`, e);
                        await db.query("UPDATE scheduled_emails SET status='failed' WHERE id=?", [row.id]);
                    }
                }
            }
        } catch (err) { console.error("[MailCron] Cron Scheduled Error:", err); }

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
                                    console.log(`[MailCron] Snoozed email ${row.message_id} restored to Inbox.`);
                                } else {
                                    console.log(`[MailCron] Snoozed email ${row.message_id} not found in Snoozed box.`);
                                    // Maybe mark as lost or deleted?
                                    // await db.query("UPDATE snoozed_emails SET status='lost' WHERE id=?", [row.id]);
                                }
                            } catch (searchErr) {
                                console.error("[MailCron] Failed to restore snoozed msg:", searchErr);
                            }
                        }
                    }
                    connection.end();
                } catch (connErr) {
                    console.error("[MailCron] IMAP Cron connection error:", connErr);
                }
            }
        } catch (err) { console.error("[MailCron] Cron Snooze Error:", err); }
    });
}

module.exports = { init };
