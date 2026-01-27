const path = require('path');
const dotenv = require('dotenv');

// Explicitly load .env from project root
dotenv.config({ path: path.join(__dirname, '../../.env') });

const mailCron = require('../services/mailCron');
const db = require('../utils/mailDb');
const sequelize = require('../config/database');

async function run() {
    console.log(`[CronRunner] Starting System Cron Task at ${new Date().toISOString()}...`);

    if (!process.env.EMAIL_USER) {
        console.log('[CronRunner] No EMAIL_USER defined. Exiting.');
        process.exit(0);
    }

    try {
        // 1. Initialize Tables/Migrations (needed if this ran before app start?)
        // Safe to run multiple times.
        const accountId = db.getAccountId(process.env.EMAIL_USER, process.env.EMAIL_HOST || process.env.HOST);
        await db.init(accountId);
        console.log('[CronRunner] DB Initialized.');

        // 2. Initialize Cron Service (sets up mailSync instance)
        mailCron.init(); // This schedules the task in-memory... wait.
        // We refactored mailCron.init to use runTasks, but it also does setup.
        // But importantly, we just want to run the TASKS immediately.
        // mailCron.init() sets up `mailSync` variable inside the module scope if not already.
        // But `init` ALSO starts the node-cron scheduler, which we don't want to keep running here if we are just "run once".
        // HOWEVER, `mailCron.js` logic for `mailSync` initialization happens at module load OR inside `init`.
        // Let's call a minimal setup steps if we can, or just call runTasks and let it handle checks?

        // Inspecting mailCron.js: 
        // `mailSync` is initialized at top level if env vars exist.
        // runTasks checks `if (mailSync)`. 
        // So we should be good just calling runTasks directly!
        // But we might want `stop()` to be called? No, runTasks is async function provided by us now.

        // One catch: `init` also calls `db.init`. We did that manually above.

        // 3. Run Tasks
        await mailCron.runTasks();

        console.log('[CronRunner] Tasks completed successfully.');

    } catch (err) {
        console.error('[CronRunner] Critical Error:', err);
    } finally {
        // 4. Force Exit (closes DB connections)
        await sequelize.close();
        console.log('[CronRunner] Exiting.');
        process.exit(0);
    }
}

run();
