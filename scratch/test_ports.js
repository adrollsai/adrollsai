const http = require('http');

const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
const slug = 'test-adrolls-2150';

async function checkPort(port) {
    return new Promise((resolve) => {
        const url = `http://localhost:${port}/shared/${userId}/${slug}`;
        console.log(`Checking URL: ${url}`);
        
        const req = http.get(url, { timeout: 3000 }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                console.log(`Port ${port} responded with Status: ${res.statusCode}`);
                if (res.statusCode >= 500) {
                    console.log(`--- Error Response Body for Port ${port} ---`);
                    console.log(data);
                } else if (res.statusCode === 200) {
                    console.log(`--- Success (Port ${port}) ---`);
                    console.log(data.slice(0, 500) + '...');
                }
                resolve(true);
            });
        });
        
        req.on('error', (err) => {
            console.log(`Port ${port} error: ${err.message}`);
            resolve(false);
        });
        
        req.on('timeout', () => {
            req.destroy();
            console.log(`Port ${port} timed out.`);
            resolve(false);
        });
    });
}

async function run() {
    for (let port = 3000; port <= 3005; port++) {
        await checkPort(port);
        console.log("----------------------------------------");
    }
}

run().catch(console.error);
