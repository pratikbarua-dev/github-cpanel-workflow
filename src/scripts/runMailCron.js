const path = require('path');
const dotenv = require('dotenv');

// Explicitly load .env from project root
dotenv.config({ path: path.join(__dirname, '../../.env') });

const mailCron = require('../services/mailCron');
const db = require('../utils/mailDb');
const sequelize = require('../config/database');
const logger = require('../config/logger');

async function run() {
    logger.info(`[CronRunner] Starting System Cron Task...`);

    if (!process.env.EMAIL_USER) {
        logger.warn('[CronRunner] No EMAIL_USER defined. Exiting.');
        process.exit(0);
    }

    try {
        // 1. Initialize Tables/Migrations (needed if this ran before app start?)
        // Safe to run multiple times.
        const accountId = db.getAccountId(process.env.EMAIL_USER, process.env.EMAIL_HOST || process.env.HOST);
        await db.init(accountId);
        // logger.info('[CronRunner] DB Initialized.'); // Optional verbose log

        // 2. Initialize Cron Service
        // mailCron.init(); // REMOVED: We don't want to start the scheduler, just run the tasks.
        // We refactored mailCron.init to use runTasks, but it also does setup.
        // But importantly, we just want to run the TASKS immediately.
        // mailCron.init() sets up `mailSync` variable inside the module scope if not already.
        // But `init` ALSO starts the node-cron scheduler, which we don't want to keep running here if we are just "run once".
        // HOWEVER, `mailCron.js` logic for `mailSync` initialization happens at top level OR inside `init`.
        // Let's call a minimal setup steps if we can, or just call runTasks and let it handle checks?

        // Inspecting mailCron.js: 
        // `mailSync` is initialized at top level if env vars exist.
        // runTasks checks `if (mailSync)`. 
        // So we should be good just calling runTasks directly!
        // But we might want `stop()` to be called? No, runTasks is async function provided by us now.

        // One catch: `init` also calls `db.init`. We did that manually above.

        // 3. Run Tasks
        // Add a safety timeout to prevent process stacking (Force kill after 55s)
        const safetyTimeout = setTimeout(() => {
            logger.error('[CronRunner] Timeout reached (55s). Forcing exit.');
            process.exit(1);
        }, 55000);

        await mailCron.runTasks();

        clearTimeout(safetyTimeout);
        logger.info('[CronRunner] Tasks completed successfully.');

    } catch (err) {
        logger.error(`[CronRunner] Critical Error: ${err.message}`);
    } finally {
        // 4. Force Exit (closes DB connections)
        await sequelize.close();
        // console.log('[CronRunner] Exiting.');
        process.exit(0);
    }
}

run();
