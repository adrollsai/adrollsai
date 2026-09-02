const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?email=eq.infobluesquareinfra@gmail.com`, {
        headers: {
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'apikey': SERVICE_KEY,
            'Content-Type': 'application/json'
        }
    });
    const profiles = await res.json();
    const token = profiles[0].facebook_token || profiles[0].selected_page_token;

    const formIds = ['1602385004210100', '4257177234535200', '1333781714785412'];

    for (const fId of formIds) {
        console.log(`\n=== CHECKING FORM ID: ${fId} ===`);
        const r = await fetch(`https://graph.facebook.com/v20.0/${fId}/leads?fields=id,created_time,field_data,campaign_name,ad_name&limit=10&access_token=${token}`);
        const data = await r.json();
        if (data.data) {
            console.log(`Found ${data.data.length} latest leads in Meta form:`);
            data.data.forEach(l => {
                const name = l.field_data?.find(f => f.name.includes('name'))?.values?.[0];
                const phone = l.field_data?.find(f => f.name.includes('phone'))?.values?.[0];
                const d = new Date(l.created_time);
                const ist = d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
                console.log(`  - [${ist}] ID: ${l.id} | ${name} | ${phone} | Ad: ${l.ad_name}`);
            });
        } else {
            console.log("Error:", data);
        }
    }
}

main().catch(console.error);
