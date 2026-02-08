require('dotenv').config();
const { Sequelize } = require('sequelize');
const sequelize = require('./src/config/database');

async function fixDatabase() {
    try {
        await sequelize.authenticate();
        console.log('✅ Connected to database.');

        const queryInterface = sequelize.getQueryInterface();
        const tableInfo = await queryInterface.describeTable('posts');

        if (!tableInfo.sub_type) {
            console.log('⚠️ Column "sub_type" missing in "posts" table. Adding it now...');

            await queryInterface.addColumn('posts', 'sub_type', {
                type: Sequelize.STRING,
                allowNull: true,
                after: 'type' // MySQL specific, ignored by SQLite
            });

            console.log('✅ Column "sub_type" added successfully.');
        } else {
            console.log('✅ Column "sub_type" already exists in "posts" table.');
        }

    } catch (error) {
        console.error('❌ Error fixing database:', error.message);
        if (error.original && error.original.sql) {
            console.error('SQL executed:', error.original.sql);
        }
    } finally {
        await sequelize.close();
        process.exit();
    }
}

fixDatabase();
