const http = require('http');

function run() {
    const options = {
        hostname: '127.0.0.1',
        port: 4040,
        path: '/api/requests/http?limit=100',
        method: 'GET'
    };

    const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
            try {
                const data = JSON.parse(body);
                const genReq = (data.requests || []).find(r => 
                    r.request?.method === 'POST' && 
                    r.request?.uri?.includes('/api/landing-page/generate')
                );
                
                if (genReq) {
                    console.log("Found generation request:", genReq.request.uri);
                    console.log("Request Body:", genReq.request.raw ? Buffer.from(genReq.request.raw, 'base64').toString('utf8') : 'No raw body');
                } else {
                    console.log("No generation request found in recent logs.");
                }
            } catch (e) {
                console.error(e);
            }
        });
    });
    req.end();
}

run();
