const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
    const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('facebook_token, ad_account_id')
        .eq('id', userId)
        .single();
        
    if (error || !profile || !profile.facebook_token || !profile.ad_account_id) {
        console.error("Profile or facebook credentials not found:", error);
        return;
    }

    const token = profile.facebook_token;
    const adAccountId = profile.ad_account_id;

    console.log(`Fetching campaigns for Ad Account: ${adAccountId}...`);
    const campaignsUrl = `https://graph.facebook.com/v19.0/${adAccountId}/campaigns?fields=id,name,status,effective_status,objective,created_time&access_token=${token}`;
    const campaignsRes = await fetch(campaignsUrl);
    const campaignsData = await campaignsRes.json();

    if (campaignsData.error) {
        console.error("Error fetching campaigns:", campaignsData.error);
        return;
    }

    const campaigns = campaignsData.data || [];
    console.log(`Found ${campaigns.length} campaigns. Querying insights for lead conversions...`);

    for (const c of campaigns) {
        console.log(`\n-------------------------------------------------------------`);
        console.log(`Campaign: "${c.name}" (ID: ${c.id}) | Status: ${c.effective_status}`);
        
        // Query insights with a broad range
        const insightsUrl = `https://graph.facebook.com/v19.0/${c.id}/insights?fields=actions,action_values,spend,impressions,clicks&date_preset=this_month&access_token=${token}`;
        const insightsRes = await fetch(insightsUrl);
        const insightsData = await insightsRes.json();
        
        if (insightsData.error) {
            console.error(`  Error fetching insights for ${c.name}:`, insightsData.error.message);
            continue;
        }

        if (insightsData.data && insightsData.data.length > 0) {
            const insights = insightsData.data[0];
            console.log(`  Spend: INR ${insights.spend} | Impressions: ${insights.impressions} | Clicks: ${insights.clicks}`);
            
            const actions = insights.actions || [];
            console.log(`  Actions recorded by Meta:`);
            actions.forEach(act => {
                console.log(`    - ${act.action_type}: ${act.value}`);
            });
        } else {
            console.log(`  No insights/activity found for this month.`);
        }
    }
}

run().catch(console.error);
