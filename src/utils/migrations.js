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
        // Helper to check if table exists
        const tableExists = async (tableName) => {
            try {
                await queryInterface.describeTable(tableName);
                return true;
            } catch (e) {
                return false;
            }
        };

        // 1. Ensure 'posts' table has 'sub_type'
        if (await tableExists('posts')) {
            const postsTable = await queryInterface.describeTable('posts');
            if (!postsTable.sub_type) {
                logger.info('⚠️ Missing column "sub_type" in "posts" table. Adding it...');
                await queryInterface.addColumn('posts', 'sub_type', {
                    type: DataTypes.STRING,
                    allowNull: true
                });
                logger.info('✅ Column "sub_type" added successfully.');
            }
        }

        // 2. Explicitly handle 'global_settings' creation if sync is slow
        if (!(await tableExists('global_settings'))) {
            logger.info('⚠️ Table "global_settings" missing. Creating manually...');
            await queryInterface.createTable('global_settings', {
                id: {
                    type: DataTypes.INTEGER,
                    primaryKey: true,
                    autoIncrement: true
                },
                key: {
                    type: DataTypes.STRING,
                    unique: true,
                    allowNull: false
                },
                value: {
                    type: DataTypes.TEXT
                },
                createdAt: {
                    type: DataTypes.DATE,
                    allowNull: false
                },
                updatedAt: {
                    type: DataTypes.DATE,
                    allowNull: false
                }
            });
            logger.info('✅ Table "global_settings" created successfully.');
        }

        logger.info('✅ Database schema check complete.');
    } catch (error) {
        logger.error(`❌ Migration process encountered an error: ${error.message}`);
    }
}

module.exports = { runMigrations };
