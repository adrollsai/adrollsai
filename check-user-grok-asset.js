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
    console.log('=== CHECK USER PROFILE FOR 2f62a259-f23b-48ee-a920-c436f36eaa4b ===');
    const userProf = await query('profiles', '?id=eq.2f62a259-f23b-48ee-a920-c436f36eaa4b');
    console.log(JSON.stringify(userProf, null, 2));

    console.log('\n=== CHECK ASSET 34d99817-0cbd-4971-9aeb-8323f0e90321 ===');
    const asset = await query('assets', '?id=eq.34d99817-0cbd-4971-9aeb-8323f0e90321');
    console.log(JSON.stringify(asset, null, 2));
}

main().catch(console.error);
