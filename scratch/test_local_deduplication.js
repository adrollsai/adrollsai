const http = require('http');

async function testLeadSubmission() {
    console.log("Simulating landing page lead submission to local API...");
    
    const eventId = 'evt_test_dedup_' + Date.now();
    const payload = JSON.stringify({
        landing_page_id: '906bdd5f-dda6-4f76-9170-4c81e90dc1f5',
        user_id: 'bc63c065-9bcc-4793-bedc-f0960406425b',
        slug: 'test-adrolls-1592',
        name: 'Deduplication Test User',
        phone: '1234567890',
        email: 'test_dedup@adrolls.in',
        city: 'Chandigarh',
        custom_question_0: '10k - 20k',
        custom_question_1: 'Immediately',
        eventId: eventId
    });

    const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/shared/landing-page/lead',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
            console.log(`Response Status: ${res.statusCode}`);
            console.log(`Response Body: ${body}`);
            try {
                const data = JSON.parse(body);
                if (data.success) {
                    console.log("✅ Lead submission verified successfully!");
                } else {
                    console.error("❌ Lead submission failed!");
                }
            } catch (e) {
                console.error("Error parsing response:", e.message);
            }
        });
    });

    req.on('error', (err) => {
        console.error("Error connecting to server:", err.message);
    });

    req.write(payload);
    req.end();
}

testLeadSubmission().catch(console.error);
