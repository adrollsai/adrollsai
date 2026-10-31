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
    const profiles = await query('profiles', '?select=id,email,business_name,facebook_token,selected_page_id,selected_page_name,selected_page_token');
    console.log(`Checking all ${profiles.length} profiles for recent token changes or Nobogent page access...`);

    for (const p of profiles) {
        if (!p.facebook_token) continue;
        try {
            const accRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?fields=id,name,access_token&limit=50&access_token=${p.facebook_token}`);
            const accData = await accRes.json();
            if (accData.data && accData.data.some(a => a.id === '1158439354021599')) {
                console.log(`FOUND NOBOGENT PAGE IN PROFILE: ${p.email} (${p.id})!`);
                const nobogent = accData.data.find(a => a.id === '1158439354021599');
                console.log(`Nobogent page token: ${nobogent.access_token.slice(0, 20)}...`);
            }
        } catch (e) {}
    }

    // Also check the debug log file if it was written
    const debugLogPath = 'C:\\Users\\Nobogent\\.gemini\\antigravity-ide\\brain\\1776ab0d-51d0-41f4-b722-78013401d2cd\\scratch\\fb_flow_debug.log';
    if (fs.existsSync(debugLogPath)) {
        console.log("Debug log found! Last 20 lines:");
        const lines = fs.readFileSync(debugLogPath, 'utf8').split('\n').filter(Boolean);
        console.log(lines.slice(-20).join('\n'));
    }
}
run().catch(console.error);
