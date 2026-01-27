const cron = require('node-cron');
const nodemailer = require('nodemailer');
const imaps = require('imap-simple');
const db = require('../utils/mailDb');
const MailSyncService = require('./mailSync');
const logger = require('../config/logger'); // Import logger
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

    } catch (err) { logger.error(`[MailCron] Cron Snooze Error: ${err.message}`); }
}

// --- LEADER ELECTION HELPERS ---
async function attemptLock(lockName, ttlSeconds = 300) {
    const now = Date.now();
    const expiresAt = now + (ttlSeconds * 1000);

    try {
        // 1. Try to Insert (if not exists)
        // MySQL: INSERT IGNORE / SQLite: INSERT OR IGNORE
        const dialect = db.getDialect();
        const insertSql = dialect === 'sqlite'
            ? "INSERT OR IGNORE INTO cron_locks (lock_name, locked_at, expires_at) VALUES (?, ?, ?)"
            : "INSERT IGNORE INTO cron_locks (lock_name, locked_at, expires_at) VALUES (?, ?, ?)";

        await db.query(insertSql, [lockName, now, expiresAt]);

        // 2. Check if we won (or if it's expired and we can steal it)
        // We use a transaction-safe update for stealing
        // "UPDATE cron_locks SET locked_at=?, expires_at=? WHERE lock_name=? AND expires_at < ?"

        await db.query(
            "UPDATE cron_locks SET locked_at=?, expires_at=? WHERE lock_name=? AND expires_at < ?",
            [now, expiresAt, lockName, now]
        );

        // 3. Verify ownership
        // In a perfect world we'd use row counting from Update, but mailDb wrapper returns rows.
        // Let's simplified check: If we just inserted, we are good.
        // If we updated expired, we are good.
        // If someone else holds it, we fail.

        const rows = await db.query("SELECT * FROM cron_locks WHERE lock_name = ?", [lockName]);
        if (rows && rows.length > 0) {
            const lock = rows[0];
            // If the lock timestamp matches ours (approx) or we know we just set it...
            // Actually, best way is to check if it matches what we wrote.
            // But precision might vary by ms.
            // Simpler: If it is NOT expired, and we didn't just write it properly...

            // Wait, the UPDATE condition `expires_at < ?` ensures we only overwrite if expired.
            // But if `INSERT IGNORE` succeeded (row didn't exist), we own it.
            // How do we know if INSERT worked? Wrapper obscures it.

            // Re-read:
            if (lock.locked_at === now && lock.expires_at === expiresAt) {
                return true; // We set it exactly now
            }
            // If we failed to update because it wasn't expired, the values will be old.
            return false;
        }

        return false;
    } catch (e) {
        logger.error(`[MailCron] Lock Error: ${e.message}`);
        return false;
    }
}

async function releaseLock(lockName) {
    try {
        // Only delete if we want to release immediately for next run?
        // Actually for "Every Minute" cron, we WANT to hold the lock for almost the whole minute 
        // to prevent others from running? NO.
        // We want to run ONCE per minute.
        // If we release immediately, another process might wake up 100ms later and run it?
        // Cron triggers periodically.
        // If process A runs at 00:01.000 -> takes 5s -> releases.
        // Process B wakes up at 00:01.001 -> sees lock -> skips.
        // Process B wakes up at 00:02.000 -> runs.

        // So we DON'T strictly need to delete the lock row, just let it expire?
        // NO, if we don't update timestamp, next minute it might still be valid?
        // We set TTL=300 (5min).
        // If we don't release/update, next minute check will verify if "expired". It won't be expiry.
        // So for "Once Per Minute" logic using locks:
        // We usually want a "Job Record" not just a "Mutex".
        // Mutex ensures mutual exclusion for *current execution*.
        // But preventing double-run in same minute?

        // Correction: Typical Leader Election means "I am the leader for this duration".
        // If I hold the lock for 5 minutes, I am the only one running tasks.
        // So if I run `cron.schedule('* * * * *')`, ONLY I should run it.
        // So I should Refresh the lock periodically?

        // SIMPLEST APPROACH for this user:
        // Attempt Lock. If successful, I am leader. 
        // DO NOT RELEASE. Keep lock.
        // Refresh lock every run.
        // If I crash, lock expires in 5 mins, someone else takes over.

        // Refined Logic for `attemptLeaderElection`:
        // 1. Get Lock.
        // 2. If held by ME (conceptually), refresh it.
        // 3. If held by valid other, return false.
        // 4. If expired, take it.

        // Since we don't have unique Process IDs easily persisted across restarts, 
        // we can just rely on the timestamp update.
        // "I update the lock to NOW + 5m".
        // If I succeed, I run.

        // Wait, if Process A updates lock at 00:01:00.
        // Process B runs at 00:01:01. It tries to update. 
        // Since it's valid, checking expiration won't help unless we check "Is it Expired?".
        // If we just check "Is Expired", then Process A claims it. B sees "Not Expired".
        // A runs task.
        // Next minute 00:02:00.
        // A runs again. Updates lock (extends duration). Runs task.
        // B runs. Sees "Not Expired". Skips.

        // This works! 
        // We just need `attemptLock` to ONLY succeed if:
        // 1. Row doesn't exist (INSERT)
        // 2. OR Row exists AND is EXPIRED (UPDATE ... WHERE expired < now)
        // 3. OR Row exists AND... wait, if A holds it, A needs to be able to Refresh it?
        //    How does A know it's A?
        //    We can generate a random `processId` on startup.

        return true;
    } catch (e) { return false; }
}

// Generate unique ID for this instance
const PROCESS_ID = Math.random().toString(36).substring(7);

async function attemptLeaderLock() {
    const lockName = 'mail_leader';
    const now = Date.now();
    const ttl = 300 * 1000; // 5 mins
    const expiresAt = now + ttl;

    try {
        // 1. Clean up very old locks? No, handled by overwrite.

        // 2. Try INSERT (if new)
        await db.query(
            "INSERT INTO cron_locks (lock_name, locked_at, expires_at) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM cron_locks WHERE lock_name = ?)",
            [lockName, PROCESS_ID, expiresAt, lockName] // Use PROCESS_ID columns? Schema has locked_at(int). 
            // Reuse `locked_at` provided schema is INT. We can store string in locked_at? No. 
            // Schema: locked_at INTEGER/BIGINT.
            // We need a specific "Owner ID" column to properly do leader election.
            // BUT schema update was already pushed. 
            // Hack: We can't identify ourselves without Owner Column.

            // ALTERNATIVE: "Job Lock" pattern (Run Lock).
            // Key = "cron_run_2026_01_27_19_40" (Key per minute).
            // Mutex for THAT minute.
            // 1. Key = `cron_${currentMinuteTimestamp}`
            // 2. Insert IGNORE. 
            // 3. If Success -> Run. 
            // 4. If Fail -> Skip.
            // Locking relies on DB constraint.
            // Cleanup? We need to delete old rows eventually.
            // This is safer for ensuring ONE execution per minute perfectly.

        );

        // Let's use the "Key per Minute" pattern. It's robust.
        return false; // Switching strategies in code below
    } catch (e) { return false; }
}

async function acquireRunLock() {
    // Generate key for this minute: "run_2024-01-01T12:00"
    const now = new Date();
    const key = `run_${now.getUTCFullYear()}_${now.getUTCMonth()}_${now.getUTCDate()}_${now.getUTCHours()}_${now.getUTCMinutes()}`;
    const timestamp = Date.now();

    // Cleanup old locks (1% chance)
    if (Math.random() < 0.01) {
        // Delete locks older than 1 hour
        const old = timestamp - 3600000;
        await db.query("DELETE FROM cron_locks WHERE expires_at < ?", [old]);
    }

    try {
        // Try INSERT. If duplicate key error (or ignore works), we know.
        // For portable SQL:
        // MySQL: INSERT IGNORE ...
        // SQLite: INSERT OR IGNORE ...
        const dialect = db.getDialect();
        const sql = dialect === 'sqlite'
            ? "INSERT OR IGNORE INTO cron_locks (lock_name, locked_at, expires_at) VALUES (?, ?, ?)"
            : "INSERT IGNORE INTO cron_locks (lock_name, locked_at, expires_at) VALUES (?, ?, ?)";

        // We capture result. In MySQL/SQLite via wrapper, getting "rows affected" is tricky unless we verify.
        // So we INSERT, then SELECT.
        // Or simpler: The one who inserts it is the runner.

        await db.query(sql, [key, timestamp, timestamp + 60000]);

        // Check if we are the one who inserted?
        // If we insert on existing, it does nothing.
        // We can check creation time?
        const rows = await db.query("SELECT * FROM cron_locks WHERE lock_name = ?", [key]);
        if (rows && rows.length > 0) {
            // If locked_at == my timestamp... race condition if 2 procs have same ms.
            // Add random jitter to logical timestamp?
            // BETTER: Use `process_id` column... ah we don't have it.

            // let's assume if we are within 100ms it's us? No.
            // Let's rely on the fact that if we ran the query, and row exists...

            // Let's use UPDATE.
            // INSERT IGNORE ensures row exists.
            // Then UPDATE ... WHERE locked_at IS NULL? No.

            // OK, simpler "Job Lock" without schema change:
            // Just use the "Task Logic" + Random Jitter.
            // Sleep random(0-5000ms).
            // Check Lock.
            // If not exist, Create. Run.
            // If exists, Skip.

            // With "INSERT IGNORE", if it returns an "affectedRows" count we are golden.
            // `db.query` wrapper returns results.
            // In Sequelize raw query: [results, metadata].
            // MySQL2 metadata has affectedRows.
            // SQLite metadata has changes.

            // BUT our wrapper `db.query` returns `results` (the first arg of sequelize return).
            // In SELECT: array of rows.
            // In INSERT: depends on driver.
            // MySQL: Object { fieldCount, affectedRows... } OR [id, affectedRows]

            // Let's just check the data. 
            // We use the timestamp as a "Signature".
            // Since we can't change schema now easily (or didn't plan to output it), 
            // We'll trust the timestamp = my timestamp.
            if (Math.abs(rows[0].locked_at - timestamp) < 5) return true;
        }
        return false;
    } catch (e) {
        // If error, fail safe
        return false;
    }
}

// Wrapping logic
async function runWithLock() {
    // 1. Generate Key for this Minute
    const now = new Date();
    // Round to minute
    const key = `cron_${Math.floor(Date.now() / 60000)}`;

    // 2. Attempt Insert
    try {
        const mySig = Date.now() + Math.floor(Math.random() * 1000); // Random sig
        const dialect = db.getDialect();

        // We need to know if WE inserted it.
        // Strategy: 
        // A. Check if exists. If yes -> Return.
        // B. Insert.
        // C. Check if my sig is there. (Race condition between A and B handled by unique constaint on C?)

        // If we use INSERT IGNORE, it silently fails if exists.
        // Then we SELECT. If sig == mySig, we won.

        const insertSql = dialect === 'sqlite'
            ? "INSERT OR IGNORE INTO cron_locks (lock_name, locked_at, expires_at) VALUES (?, ?, ?)"
            : "INSERT IGNORE INTO cron_locks (lock_name, locked_at, expires_at) VALUES (?, ?, ?)";

        await db.query(insertSql, [key, mySig, 0]);

        // Verify
        const rows = await db.query("SELECT locked_at FROM cron_locks WHERE lock_name = ?", [key]);
        if (rows && rows.length > 0) {
            if (rows[0].locked_at === mySig) {
                // We won!
                logger.info('[MailCron] Acquired lock. Running tasks...');
                await runTasks();
            } else {
                // logger.info('[MailCron] Lock held by another process. Skipping.');
            }
        }

        // Cleanup old (older than 10 mins)
        if (Math.random() < 0.05) {
            const limit = Math.floor(Date.now() / 60000) - 10;
            const oldKey = `cron_${limit}`;
            // Delete locks where name < oldKey (lexicographically roughly works for this format? no)
            // string comparison "cron_100" vs "cron_99". 
            // Just delete *all* where lock_name looks like cron_ and is old? hard in SQL sans regex.
            // Maybe delete by time? We stored `expires_at` as 0 above locally.
            // We can use `locked_at` which is timestamp (mostly).
            // Delete where locked_at < Date.now() - 600000
            await db.query("DELETE FROM cron_locks WHERE locked_at < ?", [Date.now() - 600000]);
        }

    } catch (e) {
        logger.error(`[MailCron] Locking Error: ${e.message}`);
    }
}

// Redefine init to start internal cron again
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

    // Schedule with Lock Check
    scheduledTask = cron.schedule('* * * * *', runWithLock);
}

module.exports = { init, stop, runTasks };

function stop() {
    if (scheduledTask) {
        console.log('[MailCron] Stopping cron jobs...');
        scheduledTask.stop();
        scheduledTask = null;
    }
}

module.exports = { init, stop, runTasks };
