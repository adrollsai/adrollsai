const http = require('http');

function getNgrokRequests() {
    console.log("Querying ngrok local API for request details...");
    
    const options = {
        hostname: '127.0.0.1',
        port: 4040,
        path: '/api/requests/http?limit=100',
        method: 'GET'
    };

    const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => {
            body += chunk;
        });
        
        res.on('end', () => {
            if (res.statusCode !== 200) {
                console.error(`Ngrok API returned status code ${res.statusCode}`);
                return;
            }
            
            try {
                const data = JSON.parse(body);
                console.log(`Found ${data.requests?.length || 0} requests.`);
                
                if (data.requests && data.requests.length > 0) {
                    data.requests.forEach((r, idx) => {
                        const reqMethod = r.request?.method;
                        const reqPath = r.request?.uri;
                        console.log(`[${idx + 1}] ID: ${r.id} | ${reqMethod} ${reqPath} -> Status: ${r.response?.status_code}`);
                    });
                }
            } catch (e) {
                console.error("Error parsing ngrok response:", e.message);
            }
        });
    });

    req.on('error', (err) => {
        console.error("Error querying ngrok API:", err.message);
    });

    req.end();
}

getNgrokRequests();
