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
    const profiles = await query('profiles', '?email=eq.infobluesquareinfra@gmail.com');
    const profile = profiles[0];
    const token = profile.facebook_token || profile.selected_page_token;
    const pageId = profile.selected_page_id;

    console.log("Fetching leadgen forms for page:", pageId);
    let formsUrl = `https://graph.facebook.com/v20.0/${pageId}/leadgen_forms?fields=id,name,status,created_time&limit=100&access_token=${token}`;
    const forms = [];
    while (formsUrl) {
        const r = await fetch(formsUrl);
        const d = await r.json();
        if (d.data) forms.push(...d.data);
        formsUrl = d.paging?.next || null;
    }

    console.log(`Searching all forms for any leads from Aug 31 and Sep 01 2026...`);
    for (const form of forms) {
        const leadRes = await fetch(`https://graph.facebook.com/v20.0/${form.id}/leads?fields=id,created_time,field_data,campaign_name,ad_name,adset_name&limit=15&access_token=${token}`);
        const leadData = await leadRes.json();
        if (leadData.data && leadData.data.length > 0) {
            for (const l of leadData.data) {
                const createdTime = l.created_time; // e.g. 2026-08-31... or 2026-09-01...
                if (createdTime.startsWith('2026-08-31') || createdTime.startsWith('2026-09-01')) {
                    console.log(`\nFOUND LEAD ON META:`);
                    console.log(`- Lead ID: ${l.id}`);
                    console.log(`- Created (UTC): ${l.created_time}`);
                    console.log(`- Form: "${form.name}" (ID: ${form.id})`);
                    console.log(`- Campaign: ${l.campaign_name}`);
                    console.log(`- Ad: ${l.ad_name}`);
                    console.log(`- Fields:`, JSON.stringify(l.field_data));

                    // Check CRM
                    const crmLead = await query('leads', `?or=(facebook_lead_id.eq.${l.id},phone.ilike.*${l.field_data?.find(f => f.name.includes('phone'))?.values?.[0]?.slice(-10)}*)`);
                    console.log(`- In CRM:`, crmLead.length > 0 ? { id: crmLead[0].id, name: crmLead[0].name, assigned_to: crmLead[0].assigned_to, assigned_to_user_id: crmLead[0].assigned_to_user_id, created_at: crmLead[0].created_at } : 'NOT FOUND');
                }
            }
        }
    }
}

main().catch(console.error);
