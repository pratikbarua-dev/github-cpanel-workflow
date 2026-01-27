require('dotenv').config();
const db = require('./src/utils/mailDb');

async function run() {
    try {
        console.log("Checking Mailbox Distribution...");
        const rows = await db.query("SELECT mailbox, count(*) as count FROM email_cache GROUP BY mailbox");
        console.log("Counts per mailbox:", JSON.stringify(rows, null, 2));

        console.log("Checking sample subjects in INBOX:");
        const samples = await db.query("SELECT uid, mailbox, subject FROM email_cache WHERE mailbox='INBOX' LIMIT 10");
        console.log(JSON.stringify(samples, null, 2));

    } catch (e) {
        console.error(e);
    }
}
run();
