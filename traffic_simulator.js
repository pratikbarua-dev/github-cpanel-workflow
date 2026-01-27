const https = require('https');
const url = require('url');

const BASE_URL = 'https://morphbangladesh.org';
const CONCURRENT_VISITORS = 100;
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

// Shared set of known URLs to discover deeper links collectively
const knownUrls = new Set([BASE_URL]);

// Helper to get random item from array/set
function getRandomItem(collection) {
    const items = Array.from(collection);
    return items[Math.floor(Math.random() * items.length)];
}

// Helper to wait
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function fetchPage(pageUrl, visitorId) {
    return new Promise((resolve, reject) => {
        const u = new URL(pageUrl);
        const options = {
            hostname: u.hostname,
            path: u.pathname + u.search,
            method: 'GET',
            headers: {
                'User-Agent': getRandomItem(USER_AGENTS)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';

            // Only process text/html
            const contentType = res.headers['content-type'];
            if (!contentType || !contentType.includes('text/html')) {
                res.resume(); // Consume response data to free up memory
                return resolve(null);
            }

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    body: data,
                    url: pageUrl
                });
            });
        });

        req.on('error', (e) => {
            // console.error(`[Visitor ${visitorId}] Problem with request to ${pageUrl}: ${e.message}`);
            resolve(null);
        });

        req.end();
    });
}

function extractLinks(html, currentUrl) {
    if (!html) return [];

    // Simple regex to find hrefs
    // Matches href="...", href='...'
    const linkRegex = /href=["']([^"']+)["']/g;
    const links = [];
    let match;

    while ((match = linkRegex.exec(html)) !== null) {
        let href = match[1];

        // Handle relative URLs
        try {
            const absoluteUrl = new URL(href, currentUrl).href;

            // Only strictly stay on the base domain
            if (absoluteUrl.startsWith(BASE_URL)) {

                // Exclude assets (images, css, js, pdf, etc.) if possible by extension
                // This is a rough filter
                if (!absoluteUrl.match(/\.(png|jpg|jpeg|gif|css|js|pdf|ico|svg)$/i)) {
                    links.push(absoluteUrl);
                }
            }
        } catch (e) {
            // Invalid URL, ignore
        }
    }
    return links;
}

async function createVisitor(id) {
    // Stagger start time creates a ramp-up effect
    const startDelay = Math.floor(Math.random() * 10000);
    await wait(startDelay);

    console.log(`[Visitor ${id}] Started.`);

    const visited = new Set();

    while (true) {
        // Pick a URL to visit:
        // 70% chance to visit a new unvisited URL if available
        // 30% chance to revisit a known URL (or if no new ones)

        const unvisited = Array.from(knownUrls).filter(u => !visited.has(u));
        let nextUrl;

        if (unvisited.length > 0 && Math.random() < 0.7) {
            nextUrl = getRandomItem(unvisited);
        } else {
            nextUrl = getRandomItem(knownUrls);
        }

        if (!nextUrl) nextUrl = BASE_URL; // Fallback

        // process.stdout.write(`[Visitor ${id}] Visiting: ${nextUrl} ...\n`);

        const startTime = Date.now();
        const result = await fetchPage(nextUrl, id);
        const duration = Date.now() - startTime;

        if (result && result.statusCode >= 200 && result.statusCode < 300) {
            // console.log(`[Visitor ${id}] [${result.statusCode}] (${duration}ms) ${nextUrl}`);
            visited.add(nextUrl);

            const newLinks = extractLinks(result.body, nextUrl);
            let addedCount = 0;
            newLinks.forEach(link => {
                if (!knownUrls.has(link)) {
                    knownUrls.add(link);
                    addedCount++;
                }
            });

            // if (addedCount > 0) {
            //     console.log(`[Visitor ${id}] Found ${addedCount} new links.`);
            // }

        } else if (result) {
            // console.log(`[Visitor ${id}] [${result.statusCode}] ${nextUrl}`);
        } else {
            // console.log(`[Visitor ${id}] [Failed] ${nextUrl}`);
        }

        // Random delay between 2 to 6 seconds
        const delay = Math.floor(Math.random() * 4000) + 2000;
        await wait(delay);
    }
}

async function startSimulation() {
    console.log(`Starting massive traffic simulation with ${CONCURRENT_VISITORS} visitors on ${BASE_URL}...`);
    console.log('Press Ctrl+C to stop.');

    // Spawn 100 visitors
    for (let i = 1; i <= CONCURRENT_VISITORS; i++) {
        createVisitor(i);
    }

    // Status reporter
    setInterval(() => {
        console.log(`--- STATUS: ${knownUrls.size} unique pages discovered. Active simulation running. ---`);
    }, 5000);
}

startSimulation();
