const fs = require('fs');

function parseEnv(path) {
    const content = fs.readFileSync(path, 'utf8');
    const env = {};
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx !== -1) {
            let val = trimmed.slice(idx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
            }
            env[trimmed.slice(0, idx).trim()] = val;
        }
    }
    return env;
}

const env = parseEnv('c:/Users/Adrolls/Desktop/nobogent-app/nobogent/.env.local');
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

async function run() {
    const res = await query('profiles', '?id=eq.bc63c065-9bcc-4793-bedc-f0960406425b');
    const p = res[0];
    console.log('Profile tokens:', {
        email: p.email,
        page_id: p.selected_page_id,
        user_token: p.facebook_token?.slice(0, 15),
        page_token: p.selected_page_token?.slice(0, 15)
    });

    // Check accounts with user token
    const accountsRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?fields=id,name,access_token,tasks&limit=50&access_token=${p.facebook_token}`);
    const accounts = await accountsRes.json();
    console.log('Accounts accessible:');
    if (accounts.data) {
        accounts.data.forEach(a => console.log(`- ${a.name} (${a.id})`));
    } else {
        console.log('Error fetching accounts:', accounts);
    }
}
run().catch(console.error);
