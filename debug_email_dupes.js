require('dotenv').config();
const db = require('./src/utils/mailDb');

async function run() {
    try {
        console.log("Querying duplicates...");
        const rows = await db.query("SELECT uid, mailbox, account_id, subject FROM email_cache ORDER BY date_text DESC LIMIT 20");
        console.log(JSON.stringify(rows, null, 2));

        // Count total
        const count = await db.query("SELECT count(*) as total FROM email_cache");
        console.log("Total rows:", count);

        // Count distinct UIDs
        const distinct = await db.query("SELECT count(DISTINCT uid) as unique_uids FROM email_cache");
        console.log("Unique UIDs:", distinct);

    } catch (e) {
        console.error(e);
    }
}
run();
