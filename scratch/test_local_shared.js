const http = require('http');

const url = 'http://localhost:3000/shared/29937131-1975-4c5f-9b78-e5b28f918d32/1-kanal-super-luxury-kothi-new-chandigarh-5581';

http.get(url, (res) => {
    console.log(`Status Code: ${res.statusCode}`);
    console.log(`Headers: ${JSON.stringify(res.headers, null, 2)}`);
    
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    
    res.on('end', () => {
        console.log('--- Response Body ---');
        console.log(data);
    });
}).on('error', (err) => {
    console.error('Fetch Error:', err);
});
