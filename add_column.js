const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    console.log('Checking publications table...');

    // Check if column exists
    db.all("PRAGMA table_info(publications)", (err, rows) => {
        if (err) {
            console.error('Error getting table info:', err);
            return;
        }

        const hasColumn = rows.some(row => row.name === 'heading_image');

        if (!hasColumn) {
            console.log('Column heading_image missing. Adding it...');
            db.run("ALTER TABLE publications ADD COLUMN heading_image TEXT", (err) => {
                if (err) {
                    console.error('Error adding column:', err);
                } else {
                    console.log('✅ Successfully added heading_image column!');
                }
            });
        } else {
            console.log('Column heading_image already exists.');
        }
    });
});

db.close();
