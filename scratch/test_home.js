const http = require('http');

http.get('http://localhost:3000/', (res) => {
    console.log(`Home page Status Code: ${res.statusCode}`);
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        console.log(`Response length: ${data.length}`);
        if (res.statusCode >= 400) {
            console.log("Error Response Body:", data.slice(0, 1000));
        } else {
            console.log("HTML Start:", data.slice(0, 300));
        }
    });
}).on('error', (err) => {
    console.error('Fetch Error:', err);
});
