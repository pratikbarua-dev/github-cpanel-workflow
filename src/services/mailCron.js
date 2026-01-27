const cron = require('node-cron');
const nodemailer = require('nodemailer');
const imaps = require('imap-simple');
const db = require('../utils/mailDb');
const MailSyncService = require('./mailSync');
require('dotenv').config();

// Configuration
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const HOST = process.env.EMAIL_HOST || process.env.HOST;

// Initialize Sync Service
let mailSync = null;
if (EMAIL_USER && EMAIL_PASS && HOST) {
    mailSync = new MailSyncService({
        user: EMAIL_USER,
        password: EMAIL_PASS,
        host: HOST,
        tls: true
    });
}

function init() {
    if (!process.env.ENABLE_MAIL_CLIENT || process.env.ENABLE_MAIL_CLIENT !== 'true') {
        console.log('[MailCron] Mail Client disabled. Skipping Cron init.');
        return;
    }

    // Initialize Sync Service if not already (in case env loaded late?)
    if (!mailSync && EMAIL_USER) {
        mailSync = new MailSyncService({ user: EMAIL_USER, password: EMAIL_PASS, host: HOST, tls: true });
    }

    const currentAccountId = db.getAccountId(EMAIL_USER, HOST);
    // Initialize DB with migration support
    // app.js calls db.init(), but passing accountId here ensures we're aligned?
    // app.js might call it without args. Use a singleton promise or just call it.
    // Safe to call again.
    db.init(currentAccountId);

    console.log('[MailCron] Initializing Cron Jobs...');

    // 1. Sync & Schedule Loop (Every Minute)
    scheduledTask = cron.schedule('* * * * *', async () => {
        // console.log('[MailCron] Running Cron: Sync & Schedule...');

        if (!EMAIL_USER || !EMAIL_PASS || !HOST) {
            // console.warn('[MailCron] Missing Email Config. Skipping cycle.');
            return;
        }

        // A. Run Sync
        if (mailSync) {
            try {
                await mailSync.syncAll();
            } catch (err) {
                console.error('[MailCron] Sync Error:', err);
            }
        }

        // B. Process Scheduled Emails (Existing Logic)
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

        // C. Process Snoozed Emails (Move back to Inbox) - Logic needs update?
        // If we move message on server, sync will catch it next time?
        // Snoozing involves moving msg to 'INBOX.Snoozed'.
        // Restoring moves it back to 'INBOX'.
        // If we do this via IMAP here, the Sync Service will detect the 'New' email in INBOX
        // and add it to DB (if UID changed).
        // This is fine. The user will see it reappear.

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

function stop() {
    if (scheduledTask) {
        console.log('[MailCron] Stopping cron jobs...');
        scheduledTask.stop();
        scheduledTask = null;
    }
}

module.exports = { init, stop };
