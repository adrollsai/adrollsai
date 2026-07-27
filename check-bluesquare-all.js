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
    console.log('=== ALL ASSETS FOR USER 2f62a259-f23b-48ee-a920-c436f36eaa4b ===');
    const assets = await query('assets', '?user_id=eq.2f62a259-f23b-48ee-a920-c436f36eaa4b&order=created_at.desc');
    console.log(JSON.stringify(assets, null, 2));

    console.log('\n=== ALL PROFILES MATCHING BLUESQUARE ===');
    const profiles = await query('profiles', '?business_name=ilike.*bluesquare*');
    console.log(JSON.stringify(profiles, null, 2));
}

main().catch(console.error);
