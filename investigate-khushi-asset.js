const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

async function query(table, params = '') {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
        headers: {
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'apikey': SERVICE_KEY,
            'Content-Type': 'application/json'
        }
    });
    return res.json();
}

async function main() {
    console.log('=== CHECK ASSET 9c9a846f-7e0b-4616-afef-717c14a212e4 ===');
    const asset = await query('assets', '?id=eq.9c9a846f-7e0b-4616-afef-717c14a212e4');
    console.log(JSON.stringify(asset, null, 2));

    console.log('\n=== CHECK USER PROFILE FOR d838c956-1761-4bce-9d91-32f3abecc222 ===');
    const profile = await query('profiles', '?id=eq.d838c956-1761-4bce-9d91-32f3abecc222');
    console.log(JSON.stringify(profile, null, 2));

    console.log('\n=== CHECK PROPERTY 3cdaf778-753e-4d70-b45f-0969b0648b0a ===');
    const property = await query('properties', '?id=eq.3cdaf778-753e-4d70-b45f-0969b0648b0a');
    console.log(JSON.stringify(property, null, 2));
}

main().catch(console.error);
