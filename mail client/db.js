const sqlite3 = require('sqlite3').verbose();
const mysql = require('mysql2/promise');
require('dotenv').config();

const DB_TYPE = process.env.DB_TYPE || 'sqlite';

let sqliteDb;
let mysqlPool;

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
    console.log(`Initializing Database in ${DB_TYPE.toUpperCase()} mode...`);

    if (DB_TYPE === 'mysql') {
        mysqlPool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASS || '',
            database: process.env.DB_NAME || 'mail_client',
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });

        // Test connection
        try {
            const [rows] = await mysqlPool.query('SELECT 1');
            console.log('Connected to MySQL.');
        } catch (err) {
            console.error('MySQL Connection Error:', err);
            // Don't exit, maybe they will fix env?
        }
    } else {
        sqliteDb = new sqlite3.Database('./mail_client.db', (err) => {
            if (err) console.error('SQLite Error:', err);
            else console.log('Connected to SQLite.');
        });
    }

    await createTables();
}

async function createTables() {
    const schemas = Object.keys(TABLE_SCHEMAS);

    for (const table of schemas) {
        const sql = TABLE_SCHEMAS[table][DB_TYPE];
        await query(sql);
    }
}

async function query(sql, params = []) {
    if (DB_TYPE === 'mysql') {
        try {
            const [results] = await mysqlPool.execute(sql, params);
            return results; // Returns rows for SELECT, ResultSetHeader for others
        } catch (err) {
            console.error('MySQL Query Error:', err.message);
            throw err;
        }
    } else {
        return new Promise((resolve, reject) => {
            // Determine if SELECT or other
            // Simple heuristic
            const isSelect = sql.trim().toUpperCase().startsWith('SELECT');

            if (isSelect) {
                sqliteDb.all(sql, params, (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            } else {
                sqliteDb.run(sql, params, function (err) {
                    if (err) reject(err);
                    else resolve({ insertId: this.lastID, affectedRows: this.changes });
                });
            }
        });
    }
}

function close() {
    if (sqliteDb) sqliteDb.close();
    if (mysqlPool) mysqlPool.end();
}

module.exports = { init, query, close, DB_TYPE };
