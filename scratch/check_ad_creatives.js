const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";

async function run() {
    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('facebook_token')
        .eq('id', '42d2e0c5-4fe6-4738-8a9f-63f09be01f12')
        .single();

    const token = profile.facebook_token;
    
    // Campaign: GNR HOMES
    const campaignId = '52545419490244';
    console.log(`Checking creatives for campaign ${campaignId}...`);

    const url = `${FB_MARKETING_URL}/${campaignId}/ads?fields=id,name,status,adcreatives{id,name,object_story_spec,thumbnail_url}&access_token=${token}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
        console.error("Error:", data.error.message);
        return;
    }

    const ads = data.data || [];
    for (const ad of ads) {
        console.log(`\n=== Ad: "${ad.name}" (${ad.id}) ===`);
        const creatives = ad.adcreatives?.data || [];
        for (const creative of creatives) {
            console.log(`Creative ID: ${creative.id}`);
            const spec = creative.object_story_spec;
            if (spec) {
                if (spec.link_data) {
                    console.log(`Primary Text: "${spec.link_data.message}"`);
                    console.log(`Headline: "${spec.link_data.name}"`);
                    console.log(`Description: "${spec.link_data.description}"`);
                }
                if (spec.video_data) {
                    console.log(`Primary Text (Video): "${spec.video_data.message}"`);
                    console.log(`Title/Headline (Video): "${spec.video_data.title}"`);
                }
            }
        }
    }
}

run().catch(console.error);
