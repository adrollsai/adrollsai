const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envConfig = dotenv.parse(fs.readFileSync(path.join(__dirname, '.env.local')));
const supabaseUrl = envConfig.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = envConfig.SUPABASE_SERVICE_ROLE_KEY;

async function checkProfiles() {
    const res = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
        headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
    });
    const profiles = await res.json();
    console.log("ALL PROFILES:", JSON.stringify(profiles, null, 2));
}

checkProfiles();
