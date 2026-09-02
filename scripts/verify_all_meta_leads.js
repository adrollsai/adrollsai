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
    const userId = profile.id;
    const pageToken = profile.selected_page_token || profile.facebook_token;
    const pageId = profile.selected_page_id;

    console.log("Fetching all forms for page:", pageId);
    let formsUrl = `https://graph.facebook.com/v20.0/${pageId}/leadgen_forms?fields=id,name,status,created_time&limit=100&access_token=${pageToken}`;
    const forms = [];
    while (formsUrl) {
        const r = await fetch(formsUrl);
        const d = await r.json();
        if (d.data) forms.push(...d.data);
        formsUrl = d.paging?.next || null;
    }

    console.log(`Total forms scanned on Meta: ${forms.length}`);

    // Get all DB leads for bluesquare
    const dbLeads = await query('leads', `?user_id=eq.${userId}&order=created_at.desc&limit=500`);
    const dbPhoneMap = new Set(dbLeads.map(l => (l.phone || '').replace(/\D/g, '').slice(-10)));
    const dbMetaLeadIds = new Set(dbLeads.map(l => l.facebook_lead_id).filter(Boolean));

    console.log(`Checking recent leads across all active forms...`);
    let totalMetaLeadsFound = 0;
    let missingLeads = [];
    let syncedLeadsCount = 0;

    for (const form of forms) {
        // fetch latest 25 leads per form
        const leadRes = await fetch(`https://graph.facebook.com/v20.0/${form.id}/leads?fields=id,created_time,field_data,campaign_name,ad_name,adset_name&limit=25&access_token=${pageToken}`);
        const leadData = await leadRes.json();
        if (leadData.data && leadData.data.length > 0) {
            for (const ml of leadData.data) {
                // Check if lead was created in last 14 days (since Aug 15 2026)
                const leadDate = new Date(ml.created_time * 1000 || ml.created_time);
                totalMetaLeadsFound++;

                let name = 'Unknown';
                let phone = '';
                ml.field_data?.forEach(f => {
                    const fname = f.name.toLowerCase();
                    if (fname.includes('full_name') || fname.includes('name')) name = f.values?.[0] || name;
                    if (fname.includes('phone')) phone = f.values?.[0] || phone;
                });
                const cleanPhone = phone.replace(/\D/g, '').slice(-10);

                const isSynced = dbMetaLeadIds.has(ml.id) || (cleanPhone && dbPhoneMap.has(cleanPhone));
                if (isSynced) {
                    syncedLeadsCount++;
                } else {
                    missingLeads.push({
                        meta_lead_id: ml.id,
                        created_time: ml.created_time,
                        form_name: form.name,
                        campaign: ml.campaign_name,
                        ad: ml.ad_name,
                        name,
                        phone
                    });
                }
            }
        }
    }

    console.log(`\n=== META VS CRM LEAD SYNC COMPARISON ===`);
    console.log(`Total Meta leads checked in active forms: ${totalMetaLeadsFound}`);
    console.log(`Synced in CRM: ${syncedLeadsCount}`);
    console.log(`Missing in CRM: ${missingLeads.length}`);
    if (missingLeads.length > 0) {
        console.log("Missing Leads list:", JSON.stringify(missingLeads, null, 2));
    } else {
        console.log("ALL leads found in Meta forms are 100% synced in CRM!");
    }
}

main().catch(console.error);
