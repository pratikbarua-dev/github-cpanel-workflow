const express = require('express');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const dotenv = require('dotenv');
const { spawn } = require('child_process');

const i18n = require('i18n');
const cookieParser = require('cookie-parser');

const helmet = require('helmet');

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
    console.error('========================================');
    console.error('❌ MISSING REQUIRED ENVIRONMENT VARIABLES:');
    console.error(missingVars.join(', '));
    console.error('Please configure your .env file before starting.');
    console.error('========================================');
    // In production, exit; in development, warn only
    if (process.env.NODE_ENV === 'production') {
        process.exit(1);
    }
}

// Validate SESSION_SECRET is not default
if (process.env.SESSION_SECRET === 'your_secret_key_here' ||
    process.env.SESSION_SECRET === 'secret_key') {
    console.warn('⚠️  WARNING: Using default SESSION_SECRET. Please set a secure random string in production!');
}

// Production Debug (Sanitized - no secrets)
if (process.env.NODE_ENV !== 'production') {
    console.log('--- Environment Debug ---');
    console.log('NODE_ENV:', process.env.NODE_ENV || 'development');
    console.log('DB_HOST:', process.env.DB_HOST ? 'SET' : 'NOT SET');
    console.log('RESEND_API_KEY:', process.env.RESEND_API_KEY ? 'SET' : 'NOT SET');
    console.log('-------------------------');
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

// Request Logger (ONLY in development)
if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
        next();
    });
}

// Routes
app.use('/', require('./src/routes/publicRoutes'));
app.use('/admin', require('./src/routes/adminRoutes'));

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

    // 3. Set Headers for Download
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', 'attachment; filename="backup.sql.gz"');

    // 4. Get DB Credentials from Env
    const dbUser = process.env.DB_USER;
    const dbPass = process.env.DB_PASS;
    const dbName = process.env.DB_NAME;
    // const dbHost = process.env.DB_HOST || 'localhost'; 

    // 5. Spawn mysqldump process
    const mysqldump = spawn('mysqldump', [
        '--no-tablespaces',      // Fixes cPanel permission error
        '--column-statistics=0', // Fixes version mismatch error
        '-u', dbUser,
        `-p${dbPass}`,           // No space after -p
        dbName
    ]);

    // 6. Spawn gzip process
    const gzip = spawn('gzip');

    // 7. Pipe data: mysqldump -> gzip -> Browser/Script
    mysqldump.stdout.pipe(gzip.stdin);
    gzip.stdout.pipe(res);

    mysqldump.stderr.on('data', (data) => {
        console.error(`Backup Error: ${data}`);
    });
});

// ========================================
// Database Connection (Graceful Handling)
// ========================================
const sequelize = require('./src/config/database');
const seedData = require('./seed');

sequelize.authenticate()
    .then(() => {
        console.log('✅ Database connected successfully');
        // SAFE sync - alter:false in production (no destructive changes)
        // SQLite foreign key constraints can fail during 'alter: true', so setting to false to prevent startup crashes.
        // For MySQL (Production), we enable alter to allow schema updates (like adding new columns).
        const syncOptions = { alter: !usingSQLite };
        return sequelize.sync(syncOptions);
    })
    .then(async () => {
        console.log('✅ Database synced');
        // Auto-seed if tables are empty (safe - checks before inserting)
        await seedData(false); // false = don't force wipe, only seed if empty
    })
    .catch(err => {
        console.error('❌ Database connection failed:', err.message);
        console.error('The application will continue but database features will not work.');
        // DON'T crash - let the app run so admin can see the health check
    });

// Error Handling Middleware
app.use((err, req, res, next) => {
    console.error('Application Error:', err.stack);
    res.status(500).send('Something went wrong! Please try again later.');
});

// ========================================
// Start Server
// ========================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🚀 Server started on port ${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
});

