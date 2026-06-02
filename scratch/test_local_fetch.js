const http = require('http');

http.get('http://localhost:3000/shared/2f62a259-f23b-48ee-a920-c436f36eaa4b/homeland-regalia-4166', (res) => {
    console.log(`Status Code: ${res.statusCode}`);
    console.log('Headers:', res.headers);
    
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        console.log('Data (first 500 chars):');
        console.log(data.slice(0, 500));
    });
}).on('error', (err) => {
    console.error('Fetch Error:', err);
});
