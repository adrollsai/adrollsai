const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";

async function run() {
    const userId = 'c890a11f-84ce-4592-ab8f-8682927b1a9d'; // Realty Nation
    const adId = '120249015634260295'; // Realty Nation Active Ad

    const { data: p } = await supabaseAdmin
        .from('profiles')
        .select('facebook_token')
        .eq('id', userId)
        .single();

    const token = p.facebook_token;

    console.log(`Querying Ad details for Ad: ${adId}`);
    const adRes = await fetch(`${FB_MARKETING_URL}/${adId}?fields=id,name,status,creative{id,name}&access_token=${token}`);
    const adData = await adRes.json();
    console.log("Ad Data:", JSON.stringify(adData, null, 2));

    if (adData.creative && adData.creative.id) {
        const creativeId = adData.creative.id;
        console.log(`\nQuerying Creative details for Creative: ${creativeId}`);
        const creativeRes = await fetch(`${FB_MARKETING_URL}/${creativeId}?fields=id,name,object_story_spec,call_to_action_type&access_token=${token}`);
        const creativeData = await creativeRes.json();
        console.log("Creative Details:", JSON.stringify(creativeData, null, 2));

        // Extract lead form ID from object_story_spec
        let formId = null;
        if (creativeData.object_story_spec && creativeData.object_story_spec.link_data && creativeData.object_story_spec.link_data.call_to_action) {
            const cta = creativeData.object_story_spec.link_data.call_to_action;
            if (cta.value && cta.value.lead_gen_form_id) {
                formId = cta.value.lead_gen_form_id;
            }
        } else if (creativeData.asset_data && creativeData.asset_data.call_to_action) {
            const cta = creativeData.asset_data.call_to_action;
            if (cta.value && cta.value.lead_gen_form_id) {
                formId = cta.value.lead_gen_form_id;
            }
        }

        if (formId) {
            console.log(`\nFound Lead Form ID: ${formId}. Querying status...`);
            const formRes = await fetch(`${FB_MARKETING_URL}/${formId}?fields=id,name,status,leadgen_export_csv_url,locale,questions&access_token=${token}`);
            const formData = await formRes.json();
            console.log("Form Details:", JSON.stringify(formData, null, 2));
        } else {
            console.log("\n⚠️ No lead_gen_form_id found in creative object_story_spec or asset_data.");
        }
    }
}

run().catch(console.error);
