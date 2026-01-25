require('dotenv').config();
const sequelize = require('./src/config/database');
const { User, Project, Publication, TeamMember, Post, FormSubmission, CustomForm, FormField, FormResponse } = require('./src/models');

const syncDatabase = async () => {
    try {
        await sequelize.authenticate();
        console.log('Database connected.');

        // Sync all models
        // force: true will DROP tables if they exist. Use with caution.
        // alter: true will update tables to match models.
        await sequelize.sync({ alter: true });
        console.log('Database synced successfully.');

        process.exit();
    } catch (error) {
        console.error('Unable to sync database:', error);
        process.exit(1);
    }
};

syncDatabase();
