const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    // 1. Find profile for GNR Homes or Realty Nation
    console.log("=== Fetching profiles from DB ===");
    const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('id, business_name, email, facebook_token, ad_account_id, pixel_id')
        .not('facebook_token', 'is', null);

    if (pErr) {
        console.error("Profiles fetch error:", pErr);
        return;
    }

    console.log(`Found ${profiles.length} profiles with Facebook tokens.`);
    
    for (const prof of profiles) {
        console.log(`\n--------------------------------------------`);
        console.log(`Profile: ${prof.business_name || 'N/A'} (${prof.email})`);
        console.log(`Ad Account: ${prof.ad_account_id}`);
        console.log(`Pixel ID: ${prof.pixel_id}`);
        
        if (!prof.ad_account_id || !prof.facebook_token) {
            console.log("Skipping due to missing ad account or token.");
            continue;
        }

        // Fetch campaigns from Meta Graph API
        console.log("Fetching campaigns from Meta Graph API...");
        const fbUrl = `https://graph.facebook.com/v19.0/${prof.ad_account_id}/campaigns?fields=id,name,status,start_time&limit=5&access_token=${prof.facebook_token}`;
        
        try {
            const res = await fetch(fbUrl);
            const data = await res.json();
            if (data.error) {
                console.error("Meta API Campaign Error:", data.error.message);
                continue;
            }

            const campaigns = data.data || [];
            console.log(`Found ${campaigns.length} campaigns on Meta:`);
            
            for (const camp of campaigns) {
                console.log(`  - Campaign: "${camp.name}" (ID: ${camp.id})`);
                console.log(`    Status: ${camp.status}`);
                
                // Fetch Ad Sets for this campaign
                const adsetRes = await fetch(`https://graph.facebook.com/v19.0/${camp.id}/adsets?fields=id,name,targeting&access_token=${prof.facebook_token}`);
                const adsetData = await adsetRes.json();
                const adsets = adsetData.data || [];
                
                for (const adset of adsets) {
                    console.log(`    - AdSet: "${adset.name}" (ID: ${adset.id})`);
                    const customAudiences = adset.targeting?.custom_audiences || [];
                    console.log(`      Targeted Custom Audiences:`, JSON.stringify(customAudiences));
                    
                    // Fetch details of each custom audience
                    for (const aud of customAudiences) {
                        const audRes = await fetch(`https://graph.facebook.com/v19.0/${aud.id}?fields=name,subtype,rule,description&access_token=${prof.facebook_token}`);
                        const audData = await audRes.json();
                        console.log(`        * Audience "${audData.name}" (ID: ${aud.id}):`);
                        console.log(`          Subtype: ${audData.subtype}`);
                        console.log(`          Description: ${audData.description}`);
                        console.log(`          Rule: ${JSON.stringify(audData.rule)}`);
                    }
                }
            }
        } catch (fbErr) {
            console.error("Meta communication failed:", fbErr.message);
        }
    }
}

run().catch(console.error);
