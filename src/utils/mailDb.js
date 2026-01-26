const sequelize = require('../config/database');

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
            from_text TEXT,
            subject TEXT,
            date_text TEXT,
            preview TEXT,
            html TEXT,
            attachments_json TEXT,
            is_read INTEGER DEFAULT 0,
            PRIMARY KEY (uid, mailbox)
        )`,
        mysql: `CREATE TABLE IF NOT EXISTS email_cache (
            uid INT,
            mailbox VARCHAR(255),
            from_text TEXT,
            subject TEXT,
            date_text VARCHAR(255),
            preview TEXT,
            html LONGTEXT,
            attachments_json LONGTEXT,
            is_read BOOLEAN DEFAULT FALSE,
            PRIMARY KEY (uid, mailbox)
        )`
    }
};

async function init() {
    const dialect = sequelize.getDialect();
    console.log(`[MailClient] Initializing Database Tables (Dialect: ${dialect})...`);

    const schemas = Object.keys(TABLE_SCHEMAS);
    // Map sequelize dialect to our schema keys ('sqlite' or 'mysql')
    // If mariadb or others, fallback to mysql for now as their syntax is similar for these basic tables.
    const schemaKey = dialect === 'sqlite' ? 'sqlite' : 'mysql';

    for (const table of schemas) {
        const sql = TABLE_SCHEMAS[table][schemaKey];
        try {
            await sequelize.query(sql);
        } catch (err) {
            console.error(`[MailClient] Error creating table ${table}:`, err.message);
        }
    }
}

async function query(sql, params = []) {
    // Adapter for legacy db.query(sql, params) style
    // Sequelize uses 'replacements' for ?
    try {
        const [results, metadata] = await sequelize.query(sql, {
            replacements: params
        });

        // Return results differently based on query type?
        // Sequelize query() returns [results, metadata] for raw queries by default.
        // For SELECT, 'results' is the array of rows.
        // For INSERT/UPDATE in MySQL, 'results' helps.
        // In SQLite, it might differ slightly.

        // Let's normalize. 
        // If SELECT, we want the array of rows.
        // If INSERT, we want metadata (insertId) if possible, but the mail client code 
        // mostly cared about rows for SELECT or just success for others.

        // Actually, for raw queries:
        // SQLite: [ [rows...], metadata ] (metadata contains lastID, changes)
        // MySQL: [ [rows...], metadata ] (metadata is ResultSetHeader)

        // Wait, default raw query behavior depends on `type`. 
        // If we don't specify type, it returns [results, metadata].
        // For SELECT: results is rows.
        // For INSERT (MySQL): results is ResultSetHeader (insertId etc), metadata is undefined? 
        // No, typically [results, metadata].

        // NOTE: Our consuming code expects an array of rows for SELECT.
        // For INSERT/UPDATE, it often awaits it and might use insertId inside the specialized logic?
        // Checking `mailDb.js` original:
        // SQLite: resolve(rows) for SELECT. resolve({insertId, affectedRows}) for others.
        // MySQL: resolve(rows).

        const isSelect = sql.trim().toUpperCase().startsWith('SELECT');
        if (isSelect) {
            return results;
        } else {
            // Basic return for non-select.
            // If we need insertId, we might need to inspect 'results' or 'metadata'.
            // For now, returning results is usually safe for "await db.query(...)".
            return results;
        }

    } catch (err) {
        console.error('[MailClient] Query Error:', err.message);
        throw err;
    }
}

function close() {
    // Managed by main app
}

module.exports = { init, query, close };
