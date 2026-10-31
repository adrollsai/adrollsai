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

async function insertLead(lead) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'apikey': SERVICE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        },
        body: JSON.stringify(lead)
    });
    return res.json();
}

async function run() {
    const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
    const profiles = await query('profiles', `?id=eq.${userId}`);
    const profile = profiles[0];
    const pageToken = profile.selected_page_token;

    console.log(`Syncing leads for profile ${profile.email} (${profile.selected_page_name})...`);

    const formIds = ["1787520965792113", "2262383894612079"];
    let totalImported = 0;
    const importedLeadsSummary = [];

    for (const formId of formIds) {
        const formInfoRes = await fetch(`https://graph.facebook.com/v20.0/${formId}?fields=id,name,status&access_token=${pageToken}`);
        const formInfo = await formInfoRes.json();
        console.log(`\nFetching leads for form: "${formInfo.name || formId}" (${formId})...`);

        const leadsRes = await fetch(`https://graph.facebook.com/v20.0/${formId}/leads?fields=id,created_time,field_data,campaign_id,campaign_name,ad_id,ad_name,adset_id,adset_name&limit=50&access_token=${pageToken}`);
        const leadsData = await leadsRes.json();

        if (leadsData.error) {
            console.error(`❌ Error fetching leads for form ${formId}:`, leadsData.error);
            continue;
        }

        const leads = leadsData.data || [];
        console.log(`Found ${leads.length} leads on Meta.`);

        for (const l of leads) {
            // Check if already in CRM
            const existing = await query('leads', `?user_id=eq.${userId}&facebook_lead_id=eq.${l.id}`);
            if (existing && existing.length > 0) {
                console.log(`ℹ️ Lead ${l.id} already exists in CRM (ID: ${existing[0].id}). Skipping.`);
                continue;
            }

            let name = `Meta Lead #${l.id.slice(-4)}`;
            let phone = '';
            let email = '';
            const customFields = {};

            l.field_data?.forEach(f => {
                const fn = f.name.toLowerCase().trim();
                const val = f.values?.[0] || '';
                if (fn.includes('full_name') || fn === 'name') name = val;
                else if (fn.includes('phone')) phone = val;
                else if (fn.includes('email')) email = val;
                else customFields[f.name] = val;
            });

            const newLead = {
                user_id: userId,
                name: name || 'Meta Lead',
                phone: phone || null,
                email: email || null,
                source: 'Facebook Lead Ad',
                status: 'New',
                pipeline_stage: 'New',
                ad_name: l.ad_name || null,
                form_id: formId,
                form_name: formInfo.name || null,
                campaign_id: l.campaign_id || null,
                facebook_lead_id: l.id,
                facebook_created_at: l.created_time || null,
                created_at: l.created_time || new Date().toISOString(),
                custom_fields: {
                    ...customFields,
                    is_instant_form: true,
                    ad_id: l.ad_id,
                    ad_name: l.ad_name,
                    adset_id: l.adset_id,
                    adset_name: l.adset_name,
                    campaign_id: l.campaign_id,
                    campaign_name: l.campaign_name,
                    form_id: formId,
                    form_name: formInfo.name,
                    all_facebook_lead_ids: [String(l.id)]
                }
            };

            const inserted = await insertLead(newLead);
            if (inserted && inserted[0]) {
                console.log(`✅ [IMPORTED] ${name} | ${phone} | ${email} | Campaign: ${l.campaign_name} | Ad: ${l.ad_name}`);
                totalImported++;
                importedLeadsSummary.push({
                    crm_id: inserted[0].id,
                    facebook_lead_id: l.id,
                    name,
                    phone,
                    email,
                    campaign: l.campaign_name,
                    ad: l.ad_name,
                    form: formInfo.name,
                    created_at: l.created_time
                });
            } else {
                console.error(`❌ Failed to insert lead:`, inserted);
            }
        }
    }

    console.log(`\n========================================`);
    console.log(`SUCCESSFULLY SYNCED: ${totalImported} leads imported into Nobogent CRM!`);
    console.log(`========================================`);
    console.log(JSON.stringify(importedLeadsSummary, null, 2));
}

run().catch(console.error);
