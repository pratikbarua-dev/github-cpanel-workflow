const Sequelize = require('sequelize');
const path = require('path');

let sequelize;

// Check if we should use SQLite (for local development)
const useSQLite = process.env.DB_DIALECT === 'sqlite' ||
    (process.env.NODE_ENV === 'development' && process.env.DB_DIALECT !== 'mysql');

if (useSQLite) {
    // SQLite for local development
    console.log('📦 Using SQLite database (local development)');
    sequelize = new Sequelize({
        dialect: 'sqlite',
        storage: path.join(__dirname, '../../database.sqlite'),
        logging: false
    });
} else {
    // MySQL for production (cPanel)
    const requiredDbVars = ['DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME'];
    const missingVars = requiredDbVars.filter(v => !process.env[v]);

    if (missingVars.length > 0) {
        console.error('❌ Missing required MySQL environment variables:', missingVars.join(', '));
        console.error('Set DB_DIALECT=sqlite in .env to use SQLite for development');
    }

    console.log('🐬 Using MySQL database');
    sequelize = new Sequelize(
        process.env.DB_NAME || 'morpweb',
        process.env.DB_USER || 'root',
        process.env.DB_PASS || '',
        {
            host: process.env.DB_HOST || 'localhost',
            dialect: 'mysql',
            logging: false,
            pool: {
                max: 2, // Reduced for cPanel optimization
                min: 0,
                acquire: 30000,
                idle: 10000
            },
            timezone: '+00:00'
        }
    );
}

module.exports = sequelize;


