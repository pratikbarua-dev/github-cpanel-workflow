const { Sequelize, DataTypes } = require('sequelize');
const logger = require('../config/logger');

/**
 * Automatically handle schema updates that sequelize.sync({ alter: true }) might miss 
 * or fail at in restricted environments like cPanel.
 */
async function runMigrations(sequelize) {
    const queryInterface = sequelize.getQueryInterface();

    logger.info('🔍 Checking database schema for required updates...');

    try {
        // 1. Check 'posts' table for 'sub_type' column
        const postsTable = await queryInterface.describeTable('posts');
        if (!postsTable.sub_type) {
            logger.info('⚠️ Missing column "sub_type" in "posts" table. Adding it...');
            await queryInterface.addColumn('posts', 'sub_type', {
                type: DataTypes.STRING,
                allowNull: true
            });
            logger.info('✅ Column "sub_type" added successfully.');
        }

        // Add more manual migrations here as the schema evolves
        // Example:
        // if (!postsTable.another_column) { ... }

        logger.info('✅ Database schema check complete.');
    } catch (error) {
        logger.error(`❌ Migration failed: ${error.message}`);
        // We don't throw here to allow the app to attempt a start anyway,
        // unless the migration is absolutely critical.
    }
}

module.exports = { runMigrations };
