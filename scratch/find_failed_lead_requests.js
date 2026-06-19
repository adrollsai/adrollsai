const http = require('http');

function run() {
    console.log("Fetching HTTP request history from ngrok API...");
    
    const options = {
        hostname: '127.0.0.1',
        port: 4040,
        path: '/api/requests/http?limit=1000',
        method: 'GET'
    };

    const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
            if (res.statusCode !== 200) {
                console.error(`Ngrok API status error: ${res.statusCode}`);
                return;
            }
            try {
                const data = JSON.parse(body);
                const requests = data.requests || [];
                
                const leadRequests = requests.filter(r => {
                    const uri = r.request?.uri || '';
                    return uri.includes('/lead') || uri.includes('/capi') || uri.includes('/webhook');
                });

                console.log(`Found ${leadRequests.length} matching requests (out of ${requests.length} total fetched).`);
                
                leadRequests.forEach((r, idx) => {
                    console.log(`\n--- [Request ${idx+1}] ---`);
                    console.log(`ID: ${r.id}`);
                    console.log(`Time: ${r.start_time}`);
                    console.log(`URL: ${r.request.method} ${r.request.uri}`);
                    console.log(`Response Status: ${r.response?.status_code}`);
                    
                    if (r.request.raw) {
                        try {
                            const rawStr = Buffer.from(r.request.raw, 'base64').toString();
                            console.log(`Raw Request Info:\n${rawStr.substring(0, 1000)}`);
                        } catch (e) {
                            console.log("Could not decode raw request.");
                        }
                    }
                });
            } catch (e) {
                console.error("Error parsing response:", e.message);
            }
        });
    });

    req.on('error', (err) => {
        console.error("Error connecting to ngrok:", err.message);
    });

    req.end();
}

run();
