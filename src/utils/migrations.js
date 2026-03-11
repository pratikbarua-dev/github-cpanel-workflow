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

        // 1. Ensure 'posts' table has 'sub_type' and correct 'type' ENUM
        if (await tableExists('posts')) {
            const postsTable = await queryInterface.describeTable('posts');

            // Add sub_type if missing
            if (!postsTable.sub_type) {
                logger.info('⚠️ Missing column "sub_type" in "posts" table. Adding it...');
                await queryInterface.addColumn('posts', 'sub_type', {
                    type: DataTypes.STRING,
                    allowNull: true
                });
                logger.info('✅ Column "sub_type" added successfully.');
            }

            // Update type ENUM for MySQL (Sequelize often fails at this in production)
            if (sequelize.options.dialect === 'mysql') {
                logger.info('🔄 Checking "type" ENUM values in MySQL...');
                try {
                    // We can safely run this; it adds 'CSR' and 'Training' if they were missing
                    await sequelize.query("ALTER TABLE posts MODIFY COLUMN type ENUM('News', 'Event', 'Article', 'Training', 'CSR') DEFAULT 'News'");
                    logger.info('✅ Column "type" ENUM updated successfully.');

                    // Fix existing posts that were saved with empty string due to ENUM mismatch
                    const [results] = await sequelize.query("UPDATE posts SET type = 'CSR' WHERE (type = '' OR type IS NULL) AND sub_type IS NOT NULL AND sub_type != ''");
                    if (results.affectedRows > 0) {
                        logger.info(`✅ Repaired ${results.affectedRows} CSR posts with missing type.`);
                    }

                    const [newsResults] = await sequelize.query("UPDATE posts SET type = 'News' WHERE (type = '' OR type IS NULL) AND (sub_type IS NULL OR sub_type = '')");
                    if (newsResults.affectedRows > 0) {
                        logger.info(`✅ Repaired ${newsResults.affectedRows} News posts with missing type.`);
                    }
                } catch (err) {
                    logger.error(`⚠️ Failed to update ENUM via raw query: ${err.message}`);
                }
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

        // 3. Ensure 'team_members' table has 'email' and 'linkedin' columns
        if (await tableExists('team_members')) {
            const teamTable = await queryInterface.describeTable('team_members');

            if (!teamTable.email) {
                logger.info('⚠️ Missing column "email" in "team_members" table. Adding it...');
                await queryInterface.addColumn('team_members', 'email', {
                    type: DataTypes.STRING,
                    allowNull: true
                });
                logger.info('✅ Column "email" added successfully.');
            }

            if (!teamTable.linkedin) {
                logger.info('⚠️ Missing column "linkedin" in "team_members" table. Adding it...');
                await queryInterface.addColumn('team_members', 'linkedin', {
                    type: DataTypes.STRING,
                    allowNull: true
                });
                logger.info('✅ Column "linkedin" added successfully.');
            }
        }

        // 4. Ensure 'image_url' columns are LONGTEXT for all relevant tables
        const tablesToUpdate = ['posts', 'team_members', 'projects', 'publications'];
        for (const tableName of tablesToUpdate) {
            if (await tableExists(tableName)) {
                const tableInfo = await queryInterface.describeTable(tableName);
                if (tableInfo.image_url) {
                    // For MySQL, we want to ensure it's LONGTEXT. 
                    // describeTable for MySQL returns 'longtext' if it's LONGTEXT.
                    const currentType = tableInfo.image_url.type.toLowerCase();
                    if (!currentType.includes('text') && !currentType.includes('longtext')) {
                        logger.info(`🔄 Updating "image_url" in "${tableName}" to LONGTEXT...`);
                        await queryInterface.changeColumn(tableName, 'image_url', {
                            type: DataTypes.TEXT('long'),
                            allowNull: true
                        });
                        logger.info(`✅ Table "${tableName}" image_url updated successfully.`);
                    }
                }
            }
        }

        logger.info('✅ Database schema check complete.');
    } catch (error) {
        logger.error(`❌ Migration process encountered an error: ${error.message}`);
    }
}

module.exports = { runMigrations };
