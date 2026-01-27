const sequelize = require('../config/database');
const crypto = require('crypto');

function getAccountId(user, host) {
    if (!user || !host) return 'default';
    return crypto.createHash('md5').update(`${user}:${host}`).digest('hex');
}

const TABLE_SCHEMAS = {
    scheduled_emails: {
        sqlite: `CREATE TABLE IF NOT EXISTS scheduled_emails (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user TEXT,
            to_email TEXT,
            subject TEXT,
            message TEXT,
            scheduled_time INTEGER,
            status TEXT DEFAULT 'pending'
        )`,
        mysql: `CREATE TABLE IF NOT EXISTS scheduled_emails (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user VARCHAR(255),
            to_email VARCHAR(255),
            subject TEXT,
            message LONGTEXT,
            scheduled_time BIGINT,
            status VARCHAR(50) DEFAULT 'pending'
        )`
    },
    snoozed_emails: {
        sqlite: `CREATE TABLE IF NOT EXISTS snoozed_emails (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT,
            uid INTEGER,
            original_box TEXT,
            snooze_until INTEGER,
            status TEXT DEFAULT 'active'
        )`,
        mysql: `CREATE TABLE IF NOT EXISTS snoozed_emails (
            id INT AUTO_INCREMENT PRIMARY KEY,
            message_id VARCHAR(255),
            uid INT,
            original_box VARCHAR(255),
            snooze_until BIGINT,
            status VARCHAR(50) DEFAULT 'active'
        )`
    },
    important_emails: {
        sqlite: `CREATE TABLE IF NOT EXISTS important_emails (
            uid INTEGER PRIMARY KEY
        )`,
        mysql: `CREATE TABLE IF NOT EXISTS important_emails (
            uid INT PRIMARY KEY
        )`
    },
    email_cache: {
        sqlite: `CREATE TABLE IF NOT EXISTS email_cache (
            uid INTEGER,
            mailbox TEXT,
            account_id TEXT DEFAULT 'default',
            from_text TEXT,
            subject TEXT,
            date_text TEXT,
            preview TEXT,
            html TEXT,
            attachments_json TEXT,
            is_read INTEGER DEFAULT 0,
            PRIMARY KEY (uid, mailbox, account_id)
        )`,
        mysql: `CREATE TABLE IF NOT EXISTS email_cache (
            uid INT,
            mailbox VARCHAR(255),
            account_id VARCHAR(64) DEFAULT 'default',
            from_text TEXT,
            subject TEXT,
            date_text VARCHAR(255),
            preview TEXT,
            html LONGTEXT,
            attachments_json LONGTEXT,
            is_read BOOLEAN DEFAULT FALSE,
            PRIMARY KEY (uid, mailbox, account_id)
        )`
    }
};

async function init(currentAccountId = 'default') {
    const dialect = sequelize.getDialect();
    console.log(`[MailClient] Initializing Database Tables (Dialect: ${dialect})...`);

    const schemas = Object.keys(TABLE_SCHEMAS);
    const schemaKey = dialect === 'sqlite' ? 'sqlite' : 'mysql';

    // 1. Check/Migrate email_cache if needed
    try {
        const queryInterface = sequelize.getQueryInterface();
        const tableDesc = await queryInterface.describeTable('email_cache');

        if (!tableDesc.account_id) {
            console.warn('[MailClient] Schema mismatch detected: Missing "account_id" in email_cache. Starting Migration...');

            // Step 1: Rename old table
            console.log('[MailClient] Migration: Renaming old table to email_cache_backup...');
            await sequelize.query(`ALTER TABLE email_cache RENAME TO email_cache_backup`);

            // Step 2: Create new table (will happen in loop below, but we wait for it)
            const createSql = TABLE_SCHEMAS['email_cache'][schemaKey];
            await sequelize.query(createSql);
            console.log('[MailClient] Migration: New table created.');

            // Step 3: Copy Data
            console.log(`[MailClient] Migration: Migrating data to account_id='${currentAccountId}'...`);
            // Note: We deliberately migrate existing data to the CURRENT account ID, 
            // assuming this is the first run of the new code on the existing environment.
            await sequelize.query(`
                INSERT INTO email_cache (
                    uid, mailbox, account_id, from_text, subject, date_text, preview, html, attachments_json, is_read
                )
                SELECT 
                    uid, mailbox, :accId, from_text, subject, date_text, preview, html, attachments_json, is_read
                FROM email_cache_backup
            `, {
                replacements: { accId: currentAccountId }
            });
            console.log('[MailClient] Migration: Data copied successfully.');

            // Optional: Drop backup? Kept for safety for now.
        }
    } catch (err) {
        // If table doesn't exist, describeTable throws. That's fine, we create it below.
        // console.log('[MailClient] Table check skipped (likely new):', err.message);
    }

    // 2. Ensure all tables exist
    for (const table of schemas) {
        const sql = TABLE_SCHEMAS[table][schemaKey];
        try {
            await sequelize.query(sql);
        } catch (err) {
            // Ignore "Table already exists" errors if our check above failed to suppress them or logic overlapped
            if (!err.message.includes('already exists')) {
                console.error(`[MailClient] Error creating table ${table}:`, err.message);
            }
        }
    }
}

async function query(sql, params = []) {
    try {
        const [results, metadata] = await sequelize.query(sql, {
            replacements: params
        });

        const isSelect = sql.trim().toUpperCase().startsWith('SELECT');
        if (isSelect) {
            return results;
        } else {
            return results;
        }

    } catch (err) {
        console.error('[MailClient] Query Error:', err.message);
        throw err;
    }
}

function getDialect() {
    return sequelize.getDialect();
}

function close() {
    // Managed by main app
}

module.exports = { init, query, close, getAccountId, getDialect };
