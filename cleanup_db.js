require('dotenv').config();
const db = require('./src/utils/mailDb');

async function run() {
    try {
        console.log("Cleaning up 'default' account duplicates...");
        const result = await db.query("DELETE FROM email_cache WHERE account_id = 'default'");
        console.log("Cleanup complete. Deleted rows (if any).");

        // Count total remaining
        const count = await db.query("SELECT count(*) as total FROM email_cache");
        console.log("Total rows remaining:", count);

    } catch (e) {
        console.error(e);
    }
}
run();
