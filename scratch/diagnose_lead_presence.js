const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";

const accounts = [
    {
        name: 'Realty Nation',
        userId: 'c890a11f-84ce-4592-ab8f-8682927b1a9d',
        campaignId: '120249015633660295'
    },
    {
        name: 'GNR Homes',
        userId: '42d2e0c5-4fe6-4738-8a9f-63f09be01f12',
        campaignId: '52547215473044'
    },
    {
        name: 'The ProEstate',
        userId: '29937131-1975-4c5f-9b78-e5b28f918d32',
        campaignId: '120248729046110642'
    }
];

async function run() {
    for (const acc of accounts) {
        console.log(`\n======================================================`);
        console.log(`DIAGNOSING LEADS FOR: ${acc.name}`);
        console.log(`======================================================`);

        // 1. Get profile token
        const { data: p } = await supabaseAdmin
            .from('profiles')
            .select('facebook_token, selected_page_token')
            .eq('id', acc.userId)
            .single();

        if (!p || !p.facebook_token) {
            console.error("❌ Facebook token missing");
            continue;
        }

        const token = p.facebook_token;
        const pageToken = p.selected_page_token || token; // fall back to user token if page token not set

        // 2. Fetch Ads to find Form ID
        const adsRes = await fetch(`${FB_MARKETING_URL}/${acc.campaignId}/ads?fields=id,name,creative{id,name}&access_token=${token}`);
        const adsData = await adsRes.json();
        const ads = adsData.data || [];

        let formId = null;
        for (const ad of ads) {
            if (ad.creative && ad.creative.id) {
                const creativeRes = await fetch(`${FB_MARKETING_URL}/${ad.creative.id}?fields=object_story_spec&access_token=${token}`);
                const creativeData = await creativeRes.json();
                const spec = creativeData.object_story_spec || {};
                const linkData = spec.link_data || {};
                const videoData = spec.video_data || {};
                
                formId = linkData.call_to_action?.value?.lead_gen_form_id || 
                         videoData.call_to_action?.value?.lead_gen_form_id ||
                         linkData.call_to_action_value?.lead_gen_form_id ||
                         videoData.call_to_action_value?.lead_gen_form_id || null;
                
                if (formId) {
                    console.log(`Found Form ID: ${formId} in Ad: "${ad.name}" (${ad.id})`);
                    break;
                }
            }
        }

        if (!formId) {
            console.log("⚠️ No lead form found in campaign ads.");
            continue;
        }

        // 3. Fetch leads from Meta Form
        const leadsRes = await fetch(`${FB_MARKETING_URL}/${formId}/leads?fields=id,created_time,field_data&access_token=${pageToken}`);
        const leadsData = await leadsRes.json();
        
        if (leadsData.error) {
            console.error(`❌ Meta Form Leads Error:`, leadsData.error.message);
            // Try fetching with user token if page token failed
            const retryRes = await fetch(`${FB_MARKETING_URL}/${formId}/leads?fields=id,created_time,field_data&access_token=${token}`);
            const retryData = await retryRes.json();
            if (retryData.error) {
                console.error(`❌ Meta Form Leads Retry Error:`, retryData.error.message);
                continue;
            }
            leadsData.data = retryData.data;
        }

        const fbLeads = leadsData.data || [];
        console.log(`Meta Reports ${fbLeads.length} leads generated for form ${formId}:`);

        for (const fl of fbLeads) {
            let fullName = 'N/A';
            let email = 'N/A';
            let phone = 'N/A';

            fl.field_data?.forEach(fd => {
                if (fd.name === 'full_name' || fd.name === 'name') fullName = fd.values?.[0] || 'N/A';
                if (fd.name === 'email') email = fd.values?.[0] || 'N/A';
                if (fd.name === 'phone' || fd.name === 'phone_number') phone = fd.values?.[0] || 'N/A';
            });

            // Check if this facebook_lead_id exists in our database
            const { data: dbLead, error: dbErr } = await supabaseAdmin
                .from('leads')
                .select('id, name, created_at')
                .eq('facebook_lead_id', fl.id)
                .single();

            if (dbLead) {
                console.log(`  * Lead: "${fullName}" | ID: ${fl.id} | Created: ${fl.created_time}`);
                console.log(`    Status: Sync Verified (DB ID: ${dbLead.id}, Created: ${dbLead.created_at})`);
            } else {
                console.log(`  * Lead: "${fullName}" | ID: ${fl.id} | Created: ${fl.created_time}`);
                console.log(`    ⚠️ Status: MISSING in local Database!`);
            }
        }
    }
}

run().catch(console.error);
