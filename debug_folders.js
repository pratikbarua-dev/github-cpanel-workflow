const imaps = require('imap-simple');
require('dotenv').config();

const config = {
    imap: {
        user: process.env.EMAIL_USER,
        password: process.env.EMAIL_PASS,
        host: process.env.EMAIL_HOST || process.env.HOST,
        port: 993,
        tls: true,
        authTimeout: 10000,
        tlsOptions: { rejectUnauthorized: false }
    }
};

(async () => {
    try {
        console.log('Connecting to IMAP...');
        const connection = await imaps.connect(config);
        console.log('Connected. Listing boxes...');
        const boxes = await connection.getBoxes();

        function printBoxes(boxList, prefix = '') {
            for (const key in boxList) {
                console.log(`${prefix}${key}`);
                if (boxList[key].children) {
                    printBoxes(boxList[key].children, `${prefix}${key}.`);
                }
            }
        }

        printBoxes(boxes);
        connection.end();
    } catch (err) {
        console.error('Error:', err);
    }
})();
