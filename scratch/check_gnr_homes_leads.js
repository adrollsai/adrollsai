const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";

async function run() {
    const userId = '42d2e0c5-4fe6-4738-8a9f-63f09be01f12'; // GNR HOMES
    const adIds = ['52547215483044', '52547215491244']; // GNR Homes Ads

    const { data: p } = await supabaseAdmin
        .from('profiles')
        .select('facebook_token, selected_page_token, selected_page_id')
        .eq('id', userId)
        .single();

    const token = p.facebook_token;
    const pageToken = p.selected_page_token;
    const pageId = p.selected_page_id;

    if (!token || !pageToken) {
        console.error("Tokens missing");
        return;
    }

    // 1. Get database leads to cross-check
    const { data: dbLeads } = await supabaseAdmin
        .from('leads')
        .select('facebook_lead_id')
        .eq('user_id', userId);
    const dbLeadIds = new Set(dbLeads.map(l => l.facebook_lead_id).filter(Boolean));

    console.log(`GNR Homes Page ID: ${pageId}`);

    // Query active ads to find forms
    for (const adId of adIds) {
        console.log(`\nQuerying Ad details for Ad: ${adId}`);
        const adRes = await fetch(`${FB_MARKETING_URL}/${adId}?fields=id,name,status,creative{id,name}&access_token=${token}`);
        const adData = await adRes.json();
        
        if (adData.creative && adData.creative.id) {
            const creativeId = adData.creative.id;
            const creativeRes = await fetch(`${FB_MARKETING_URL}/${creativeId}?fields=id,name,object_story_spec,call_to_action_type&access_token=${token}`);
            const creativeData = await creativeRes.json();
            
            let formId = null;
            if (creativeData.object_story_spec && creativeData.object_story_spec.video_data && creativeData.object_story_spec.video_data.call_to_action) {
                formId = creativeData.object_story_spec.video_data.call_to_action.value?.lead_gen_form_id;
            } else if (creativeData.object_story_spec && creativeData.object_story_spec.link_data && creativeData.object_story_spec.link_data.call_to_action) {
                formId = creativeData.object_story_spec.link_data.call_to_action.value?.lead_gen_form_id;
            }

            if (formId) {
                console.log(`Found Form ID: ${formId} in creative.`);
                // Query leads count
                const formRes = await fetch(`${FB_MARKETING_URL}/${formId}?fields=id,name,status,leads_count&access_token=${pageToken}`);
                const formData = await formRes.json();
                console.log(`Form details: Name="${formData.name}" | Status=${formData.status} | Leads Count=${formData.leads_count}`);

                // Fetch leads from Meta
                const leadsRes = await fetch(`${FB_MARKETING_URL}/${formId}/leads?fields=id,created_time,field_data&access_token=${pageToken}`);
                const leadsData = await leadsRes.json();
                const fbLeads = leadsData.data || [];
                console.log(`Meta leads fetched: ${fbLeads.length}`);
                
                fbLeads.forEach(l => {
                    let name = 'Unknown';
                    l.field_data?.forEach(f => {
                        if (f.name === 'full_name' || f.name === 'name') name = f.values[0];
                    });
                    console.log(`  * Lead: ${name} (ID: ${l.id}) | Status in CRM: ${dbLeadIds.has(l.id) ? '✅ FOUND' : '❌ MISSING'}`);
                });
            } else {
                console.log("No lead form found in creative.");
            }
        }
    }
}

run().catch(console.error);
