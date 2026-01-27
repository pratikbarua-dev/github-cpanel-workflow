const express = require('express');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const dotenv = require('dotenv');
const { spawn } = require('child_process');

const i18n = require('i18n');
const cookieParser = require('cookie-parser');

const helmet = require('helmet');
const morgan = require('morgan'); // Import morgan
const logger = require('./src/config/logger'); // Import logger

// Load env vars FIRST
dotenv.config();

// ========================================
// Environment Validation (cPanel Production)
// ========================================
const usingSQLite = process.env.DB_DIALECT === 'sqlite';

// Only require MySQL vars if not using SQLite
const requiredEnvVars = usingSQLite
    ? ['SESSION_SECRET']
    : ['SESSION_SECRET', 'DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME'];

const missingVars = requiredEnvVars.filter(v => !process.env[v]);

if (missingVars.length > 0) {
    logger.error('========================================');
    logger.error('❌ MISSING REQUIRED ENVIRONMENT VARIABLES:');
    logger.error(missingVars.join(', '));
    logger.error('Please configure your .env file before starting.');
    logger.error('========================================');
    // In production, exit; in development, warn only
    if (process.env.NODE_ENV === 'production') {
        process.exit(1);
    }
}

// Validate SESSION_SECRET is not default
if (process.env.SESSION_SECRET === 'your_secret_key_here' ||
    process.env.SESSION_SECRET === 'secret_key') {
    logger.warn('⚠️  WARNING: Using default SESSION_SECRET. Please set a secure random string in production!');
}

// Production Debug (Sanitized - no secrets)
if (process.env.NODE_ENV !== 'production') {
    logger.info('--- Environment Debug ---');
    logger.info(`NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`DB_HOST: ${process.env.DB_HOST ? 'SET' : 'NOT SET'}`);
    logger.info(`RESEND_API_KEY: ${process.env.RESEND_API_KEY ? 'SET' : 'NOT SET'}`);
    logger.info('-------------------------');
}

// i18n Configuration
i18n.configure({
    locales: ['en', 'bn'],
    directory: path.join(__dirname, 'locales'),
    defaultLocale: 'en',
    cookie: 'lang',
    objectNotation: true
});

const app = express();

// Middleware
app.use(helmet({
    contentSecurityPolicy: false, // Disabling CSP for development simplicity
    crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session Config
app.use(session({
    secret: process.env.SESSION_SECRET || 'change_this_secret_in_production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

app.use(cookieParser());
app.use(i18n.init);

// Set Locale from Query Parameter (e.g. ?lang=bn)
app.use((req, res, next) => {
    if (req.query.lang) {
        res.cookie('lang', req.query.lang);
        req.setLocale(req.query.lang);
    }
    // Make BASE_URL available to all views
    res.locals.baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    next();
});

// Passport Config
require('./src/config/passport')(passport);
app.use(passport.initialize());
app.use(passport.session());

// Health Check Endpoint
app.get('/ping', (req, res) => {
    res.status(200).send('Pong');
});

// Request Logger
app.use(morgan('combined', { stream: logger.stream }));

// Routes
app.use('/', require('./src/routes/publicRoutes'));
app.use('/admin', require('./src/routes/adminRoutes'));
// Initialize Mail Cron Jobs and Tables
if (process.env.ENABLE_MAIL_CLIENT === 'true') {
    app.use('/mail', require('./src/routes/mailRoutes'));

    const mailCron = require('./src/services/mailCron');
    const mailDb = require('./src/utils/mailDb');

    // Ensure tables are created and cron is started
    mailDb.init().then(() => {
        // mailCron.init(); 
        // INTERNAL CRON DISABLED: Use system cron via src/scripts/runMailCron.js to reduce NPROC
        console.log('[MailClient] DB Initialized. Internal cron disabled (System Cron required).');
    }).catch(err => {
        console.error("Failed to initialize Mail Client:", err);
    });
} else {
    // Mail Client Disabled Fallback
    const { ensureAuthenticated } = require('./src/middleware/auth');
    app.get('/mail', ensureAuthenticated, (req, res) => {
        res.render('mail/disabled', {
            title: 'Mail Client - Not Subscribed',
            path: '/mail',
            user: req.user
        });
    });
}

// --- SYSTEM BACKUP BRIDGE ROUTE ---
app.get('/system-backup', (req, res) => {
    // 1. Get Secret from Env
    const secretKey = process.env.BACKUP_SECRET_KEY;

    if (!secretKey) {
        console.error("Error: BACKUP_SECRET_KEY missing in .env");
        return res.status(500).send("Configuration Error");
    }

    // 2. Verify Key
    if (req.query.key !== secretKey) {
        return res.status(403).send("Access Denied");
    }

    // Check if we're using SQLite or MySQL
    const usingSQLiteBackup = process.env.DB_DIALECT === 'sqlite';

    if (usingSQLiteBackup) {
        // --- SQLite Backup (for local development) ---
        const fs = require('fs');
        const sqliteDbPath = path.join(__dirname, 'database.sqlite');

        if (!fs.existsSync(sqliteDbPath)) {
            return res.status(404).send("SQLite database not found");
        }

        // Set Headers for SQLite download (gzipped)
        res.setHeader('Content-Type', 'application/gzip');
        res.setHeader('Content-Disposition', 'attachment; filename="backup.sqlite.gz"');

        // Stream the SQLite file through gzip
        const gzip = spawn('gzip', ['-c', sqliteDbPath]);
        gzip.stdout.pipe(res);

        gzip.stderr.on('data', (data) => {
            console.error(`SQLite Backup Error: ${data}`);
        });

        gzip.on('close', (code) => {
            if (code !== 0) {
                console.error(`gzip exited with code ${code}`);
            }
        });

    } else {
        // --- MySQL Backup (for production) ---
        // 3. Set Headers for Download
        res.setHeader('Content-Type', 'application/gzip');
        res.setHeader('Content-Disposition', 'attachment; filename="backup.sql.gz"');

        // 4. Get DB Credentials from Env
        const dbUser = process.env.DB_USER;
        const dbPass = process.env.DB_PASS;
        const dbName = process.env.DB_NAME;

        console.log(`[BACKUP] Starting MySQL backup for database: ${dbName}`);
        console.log(`[BACKUP] User: ${dbUser}, Timestamp: ${new Date().toISOString()}`);

        // 5. Spawn mysqldump process
        // Note: --column-statistics=0 removed (not supported on older MySQL versions in cPanel)
        const mysqldump = spawn('mysqldump', [
            '--no-tablespaces',  // Fixes cPanel permission error
            '-u', dbUser,
            `-p${dbPass}`,       // No space after -p
            dbName
        ]);

        // 6. Spawn gzip process
        const gzip = spawn('gzip');

        // 7. Pipe data: mysqldump -> gzip -> Browser/Script
        mysqldump.stdout.pipe(gzip.stdin);
        gzip.stdout.pipe(res);

        mysqldump.stderr.on('data', (data) => {
            const errorMsg = data.toString();
            // Filter out the password warning (not a real error)
            if (!errorMsg.includes('Using a password on the command line')) {
                console.error(`[BACKUP ERROR] ${errorMsg}`);
            }
        });

        mysqldump.on('close', (code) => {
            if (code === 0) {
                console.log(`[BACKUP] mysqldump completed successfully`);
            } else {
                console.error(`[BACKUP ERROR] mysqldump exited with code ${code}`);
            }
        });

        gzip.on('close', (code) => {
            if (code === 0) {
                console.log(`[BACKUP] Backup stream complete`);
            } else {
                console.error(`[BACKUP ERROR] gzip exited with code ${code}`);
            }
        });
    }
});

// --- SYSTEM RESTORE BRIDGE ROUTE ---
const multer = require('multer');
const zlib = require('zlib');
const fs = require('fs');
const os = require('os');

// Configure multer to store uploaded file in temp directory
const upload = multer({
    dest: os.tmpdir(),
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB max
});

app.post('/system-restore', upload.single('backup'), async (req, res) => {
    // 1. Get Secret from Env
    const secretKey = process.env.BACKUP_SECRET_KEY;

    if (!secretKey) {
        console.error("Error: BACKUP_SECRET_KEY missing in .env");
        return res.status(500).json({ success: false, error: "Configuration Error" });
    }

    // 2. Verify Key (from query or header)
    const providedKey = req.query.key || req.headers['x-backup-key'];
    if (providedKey !== secretKey) {
        return res.status(403).json({ success: false, error: "Access Denied" });
    }

    // 3. Check if file was uploaded
    if (!req.file) {
        return res.status(400).json({ success: false, error: "No backup file provided" });
    }

    const uploadedFile = req.file.path;
    console.log(`Restore request received: ${req.file.originalname} (${req.file.size} bytes)`);

    // Check if we're using SQLite or MySQL
    const usingSQLiteRestore = process.env.DB_DIALECT === 'sqlite';

    try {
        if (usingSQLiteRestore) {
            // --- SQLite Restore ---
            const sqliteDbPath = path.join(__dirname, 'database.sqlite');
            const backupPath = sqliteDbPath + '.pre_restore_bak';

            // Decompress the uploaded file
            const tempSqlite = path.join(os.tmpdir(), 'temp_restore.sqlite');

            await new Promise((resolve, reject) => {
                const gunzip = zlib.createGunzip();
                const input = fs.createReadStream(uploadedFile);
                const output = fs.createWriteStream(tempSqlite);

                input.pipe(gunzip).pipe(output);
                output.on('finish', resolve);
                output.on('error', reject);
                gunzip.on('error', reject);
            });

            // Backup current database
            if (fs.existsSync(sqliteDbPath)) {
                fs.copyFileSync(sqliteDbPath, backupPath);
            }

            // Replace with restored database
            fs.copyFileSync(tempSqlite, sqliteDbPath);
            fs.unlinkSync(tempSqlite);
            fs.unlinkSync(uploadedFile);

            const stats = fs.statSync(sqliteDbPath);
            console.log(`SQLite restore complete: ${stats.size} bytes`);

            return res.json({
                success: true,
                message: "SQLite database restored successfully",
                size: stats.size,
                rollback: "database.sqlite.pre_restore_bak"
            });

        } else {
            // --- MySQL Restore ---
            const dbUser = process.env.DB_USER;
            const dbPass = process.env.DB_PASS;
            const dbName = process.env.DB_NAME;
            const dbHost = process.env.DB_HOST || 'localhost';

            console.log(`[RESTORE] Starting MySQL restore for database: ${dbName}`);
            console.log(`[RESTORE] User: ${dbUser}, Host: ${dbHost}, Timestamp: ${new Date().toISOString()}`);

            // Create restore command: zcat file.gz | mysql
            const gunzip = spawn('zcat', [uploadedFile]);
            const mysql = spawn('mysql', [
                '-h', dbHost,
                '-u', dbUser,
                `-p${dbPass}`,
                dbName
            ]);

            // Pipe: gunzip -> mysql
            gunzip.stdout.pipe(mysql.stdin);

            let stderrOutput = '';
            mysql.stderr.on('data', (data) => {
                const msg = data.toString();
                stderrOutput += msg;
                // Filter out password warning
                if (!msg.includes('Using a password on the command line')) {
                    console.error(`[RESTORE ERROR] ${msg}`);
                }
            });

            gunzip.stderr.on('data', (data) => {
                console.error(`[RESTORE ERROR] zcat: ${data.toString()}`);
            });

            await new Promise((resolve, reject) => {
                mysql.on('close', (code) => {
                    // Clean up uploaded file
                    fs.unlinkSync(uploadedFile);

                    if (code !== 0) {
                        console.error(`[RESTORE ERROR] mysql exited with code ${code}`);
                        reject(new Error(stderrOutput || `mysql exited with code ${code}`));
                    } else {
                        console.log(`[RESTORE] mysql import completed successfully`);
                        resolve();
                    }
                });
                mysql.on('error', (err) => {
                    console.error(`[RESTORE ERROR] mysql spawn error: ${err.message}`);
                    reject(err);
                });
                gunzip.on('error', (err) => {
                    console.error(`[RESTORE ERROR] zcat error: ${err.message}`);
                    reject(err);
                });
            });

            console.log(`[RESTORE] MySQL restore complete: ${dbName}`);
            return res.json({
                success: true,
                message: `MySQL database '${dbName}' restored successfully`
            });
        }

    } catch (error) {
        console.error(`[RESTORE ERROR] ${error.message}`);

        // Clean up uploaded file
        if (fs.existsSync(uploadedFile)) {
            fs.unlinkSync(uploadedFile);
        }

        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// --- SYSTEM FORCE KILL ROUTE (Zombie Process Cleanup) ---
app.get('/system-force-kill', (req, res) => {
    const secretKey = process.env.BACKUP_SECRET_KEY;
    if (!secretKey || req.query.key !== secretKey) {
        return res.status(403).send("Access Denied");
    }

    console.log('Received System Force Kill Request. Executing pkill...');

    // Execute pkill to kill ALL node processes for this user
    const { exec } = require('child_process');
    exec('pkill -f node', (error, stdout, stderr) => {
        if (error) {
            console.error(`pkill error: ${error}`);
            // Note: If pkill works, this might not even be reached as the server dies
            return res.status(500).send(`Error: ${error.message}`);
        }
        console.log(`pkill output: ${stdout}`);
        res.send("Kill command executed. Server should restart momentarily.");
    });
});

// ========================================
// Database Connection (Graceful Handling)
// ========================================
const sequelize = require('./src/config/database');
const seedData = require('./seed');

sequelize.authenticate()
    .then(() => {
        logger.info('✅ Database connected successfully');
        // SAFE sync - alter:false in production (no destructive changes)
        // SQLite foreign key constraints can fail during 'alter: true', so setting to false to prevent startup crashes.
        // For MySQL (Production), we enable alter to allow schema updates (like adding new columns).
        const syncOptions = { alter: !usingSQLite };
        return sequelize.sync(syncOptions);
    })
    .then(async () => {
        logger.info('✅ Database synced');
        // Auto-seed if tables are empty (safe - checks before inserting)
        await seedData(false); // false = don't force wipe, only seed if empty
    })
    .catch(err => {
        logger.error(`❌ Database connection failed: ${err.message}`);
        logger.error('The application will continue but database features will not work.');
        // DON'T crash - let the app run so admin can see the health check
    });

// Error Handling Middleware
app.use((err, req, res, next) => {
    logger.error(`Application Error: ${err.stack}`);
    res.status(500).send('Something went wrong! Please try again later.');
});

// ========================================
// Start Server
// ========================================
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
    console.log(`🚀 Server started on port ${PORT}`);
    logger.info(`🚀 Server started on port ${PORT}`);
    logger.info(`   Environment: ${process.env.NODE_ENV || 'development'}`);
});

server.on('error', (err) => {
    console.error('❌ Server failed to start:', err.message);
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is currently in use. Please stop the other process.`);
    }
});

// ========================================
// Graceful Shutdown Logic
// ========================================
const gracefulShutdown = async (signal) => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    // 1. Stop Server accepting new connections
    server.close(() => {
        logger.info('Http server closed.');
    });

    // 2. Stop Cron Jobs
    if (process.env.ENABLE_MAIL_CLIENT === 'true') {
        try {
            const mailCron = require('./src/services/mailCron');
            mailCron.stop();
            logger.info('Cron jobs stopped.');
        } catch (err) {
            logger.error('Error stopping cron jobs:', err.message);
        }
    }

    // 3. Close Database Connection
    try {
        await sequelize.close();
        logger.info('Database connection closed.');
    } catch (err) {
        logger.error('Error closing database connection:', err.message);
    }

    logger.info('Graceful shutdown complete. Exiting.');
    process.exit(0);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

