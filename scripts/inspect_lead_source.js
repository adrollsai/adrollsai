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
    const lead = await query('leads', '?name=ilike.*PK Grover*');
    console.log("PK Grover lead in DB:", JSON.stringify(lead, null, 2));

    const leadsSinceAug29 = await query('leads', '?user_id=eq.2f62a259-f23b-48ee-a920-c436f36eaa4b&created_at=gte.2026-08-29T00:00:00Z&order=created_at.desc');
    console.log("Leads count since Aug 29 in DB:", leadsSinceAug29.length);
    leadsSinceAug29.forEach(l => {
        console.log(`[${l.created_at}] "${l.name}" | FormID: ${l.form_id || l.meta_data?.form_id} | PageID: ${l.page_id || l.meta_data?.page_id} | Camp: ${l.campaign || l.campaign_name}`);
    });
}

main().catch(console.error);
