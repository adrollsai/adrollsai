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

async function updateLead(id, payload) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${id}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'apikey': SERVICE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        },
        body: JSON.stringify(payload)
    });
    return res.json();
}

async function run() {
    const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
    const profiles = await query('profiles', `?id=eq.${userId}`);
    const token = profiles[0].selected_page_token;

    const leadsInDb = await query('leads', `?user_id=eq.${userId}&source=eq.Facebook Lead Ad&order=created_at.desc`);
    console.log(`Checking all ${leadsInDb.length} Facebook leads in CRM...`);

    for (const lead of leadsInDb) {
        if (!lead.facebook_lead_id) continue;
        const res = await fetch(`https://graph.facebook.com/v20.0/${lead.facebook_lead_id}?fields=id,field_data&access_token=${token}`);
        const metaLead = await res.json();

        if (metaLead.field_data) {
            let name = lead.name;
            let phone = lead.phone || '';
            let email = lead.email || '';
            let existingCf = lead.custom_fields || {};
            if (typeof existingCf === 'string') {
                try { existingCf = JSON.parse(existingCf); } catch (e) { existingCf = {}; }
            }
            const customFields = { ...(existingCf || {}) };

            metaLead.field_data.forEach(f => {
                const fn = f.name.toLowerCase().trim();
                const val = f.values?.[0] || '';
                if (fn.includes('full_name') || fn === 'name') name = val;
                else if (fn.includes('whatsapp') || fn.includes('phone') || fn.includes('number') || fn.includes('contact') || fn.includes('mobile')) {
                    if (!phone || fn.includes('whatsapp')) phone = val;
                } else if (fn.includes('email')) {
                    email = val;
                }
                customFields[f.name] = val;
            });

            await updateLead(lead.id, {
                name,
                phone: phone || null,
                email: email || null,
                custom_fields: customFields
            });
        }
    }

    // Print final verification
    const verified = await query('leads', `?user_id=eq.${userId}&source=eq.Facebook Lead Ad&order=created_at.desc`);
    console.log(`\nVerified Leads in Nobogent CRM (${verified.length} leads):`);
    verified.forEach(l => {
        console.log(`- ${l.name} | Phone: ${l.phone} | Campaign: ${l.custom_fields?.campaign_name} | Ad: ${l.ad_name} | Form: ${l.form_name} | City: ${l.custom_fields?.city || 'N/A'}`);
    });
}

run().catch(console.error);
