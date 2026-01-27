const cron = require('node-cron');
const nodemailer = require('nodemailer');
const imaps = require('imap-simple');
const db = require('../utils/mailDb');
const MailSyncService = require('./mailSync');
const logger = require('../config/logger');
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

// ---------------------------------------------------------
// CORE TASK LOGIC (Executes the actual work)
// ---------------------------------------------------------
async function runTasks() {
    // logger.info('[MailCron] Running Cron: Sync & Schedule...');

    if (!EMAIL_USER || !EMAIL_PASS || !HOST) {
        // logger.warn('[MailCron] Missing Email Config. Skipping cycle.');
        return;
    }

    // A. Run Sync
    if (mailSync) {
        try {
            await mailSync.syncAll();
        } catch (err) {
            logger.error(`[MailCron] Sync Error: ${err.message}`);
        }
    }

    // B. Process Scheduled Emails
    try {
        const rows = await db.query("SELECT * FROM scheduled_emails WHERE status='pending' AND scheduled_time <= ?", [Date.now()]);

        if (rows && rows.length > 0) {
            for (const row of rows) {
                try {
                    let transporter = nodemailer.createTransport({
                        host: HOST,
                        port: 465, // Assume secure for now
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
                    logger.info(`[MailCron] Scheduled email ${row.id} sent.`);

                } catch (e) {
                    logger.error(`[MailCron] Failed to send scheduled email ${row.id}: ${e.message}`);
                    await db.query("UPDATE scheduled_emails SET status='failed' WHERE id=?", [row.id]);
                }
            }
        }
    } catch (err) { logger.error(`[MailCron] Cron Scheduled Error: ${err.message}`); }

    // C. Process Snoozed Emails
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
                    if (row.message_id) {
                        try {
                            const searchCriteria = [['HEADER', 'MESSAGE-ID', row.message_id]];
                            const fetchOptions = { bodies: [''], markSeen: false };
                            const messages = await connection.search(searchCriteria, fetchOptions);

                            if (messages.length > 0) {
                                const foundUid = messages[0].attributes.uid;
                                await connection.moveMessage([foundUid], row.original_box || 'INBOX');
                                await db.query("DELETE FROM snoozed_emails WHERE id=?", [row.id]);
                                logger.info(`[MailCron] Snoozed email ${row.message_id} restored to Inbox.`);
                            } else {
                                logger.info(`[MailCron] Snoozed email ${row.message_id} not found in Snoozed box.`);
                            }
                        } catch (searchErr) {
                            logger.error(`[MailCron] Failed to restore snoozed msg: ${searchErr.message}`);
                        }
                    }
                }
                connection.end();
            } catch (connErr) {
                logger.error(`[MailCron] IMAP Cron connection error: ${connErr.message}`);
            }
        }
    } catch (err) { logger.error(`[MailCron] Cron Snooze Error: ${err.message}`); }
}

// ---------------------------------------------------------
// LEADER ELECTION (Locking)
// ---------------------------------------------------------

async function runWithLock() {
    // 1. Generate Key for this Minute (e.g., "cron_28471200")
    // This ensures only ONE execution per minute globally.
    const now = new Date();
    const minuteTimestamp = Math.floor(Date.now() / 60000);
    const key = `cron_${minuteTimestamp}`;

    try {
        const mySig = Date.now() + Math.floor(Math.random() * 1000); // Random signature
        const dialect = db.getDialect();

        // 2. Atomic Insert (Try to claim this minute)
        // If row exists, this might fail or ignore, depending on dialect.
        const insertSql = dialect === 'sqlite'
            ? "INSERT OR IGNORE INTO cron_locks (lock_name, locked_at, expires_at) VALUES (?, ?, ?)"
            : "INSERT IGNORE INTO cron_locks (lock_name, locked_at, expires_at) VALUES (?, ?, ?)";

        await db.query(insertSql, [key, mySig, 0]);

        // 3. Verify Ownership
        // We check if the lock for this minute has OUR signature.
        const rows = await db.query("SELECT locked_at FROM cron_locks WHERE lock_name = ?", [key]);
        if (rows && rows.length > 0) {
            if (rows[0].locked_at === mySig) {
                // We won the race! We are the leader for this minute.
                logger.info('[MailCron] Acquired lock. Running tasks...');
                await runTasks();
            } else {
                // Someone else won. We do nothing.
                // logger.info('[MailCron] Lock held by another process. Skipping.');
            }
        }

        // 4. Cleanup old locks (1% chance to run cleanup)
        // Deletes locks older than 10 minutes to keep table small.
        if (Math.random() < 0.01) {
            const tenMinsAgo = Date.now() - 600000;
            await db.query("DELETE FROM cron_locks WHERE locked_at < ?", [tenMinsAgo]);
        }

    } catch (e) {
        logger.error(`[MailCron] Locking Error: ${e.message}`);
    }
}

// ---------------------------------------------------------
// MODULE API
// ---------------------------------------------------------

let scheduledTask = null;

function init() {
    if (!process.env.ENABLE_MAIL_CLIENT || process.env.ENABLE_MAIL_CLIENT !== 'true') {
        return;
    }

    if (!mailSync && EMAIL_USER) {
        mailSync = new MailSyncService({ user: EMAIL_USER, password: EMAIL_PASS, host: HOST, tls: true });
    }

    const currentAccountId = db.getAccountId(EMAIL_USER, HOST);
    db.init(currentAccountId);

    console.log('[MailCron] Internal Cron (Leader Election) Started.');

    // Schedule: Runs every minute, but uses runWithLock to race for execution.
    scheduledTask = cron.schedule('* * * * *', runWithLock);
}

function stop() {
    if (scheduledTask) {
        console.log('[MailCron] Stopping cron jobs...');
        scheduledTask.stop();
        scheduledTask = null;
    }
}

module.exports = { init, stop, runTasks };
