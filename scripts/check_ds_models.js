const dotenv = require('dotenv');
dotenv.config();

async function check() {
    const key = (process.env.DEEPSEEK_API_KEY || '').replace(/^["']|["']$/g, '').trim();
    const res = await fetch('https://api.deepseek.com/models', {
        headers: { 'Authorization': 'Bearer ' + key }
    });
    const data = await res.json();
    console.log('DEEPSEEK MODELS:', JSON.stringify(data, null, 2));
}

check();
