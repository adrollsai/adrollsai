const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const targetUserId = '29937131-1975-4c5f-9b78-e5b28f918d32';

async function run() {
    console.log("Fetching current profile state...");
    const { data: profile, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', targetUserId)
        .single();

    if (fetchError) {
        console.error("Fetch Error:", fetchError);
        return;
    }

    console.log("CURRENT STATE:");
    console.log("  subscription_plan:", profile.subscription_plan);
    console.log("  ai_creatives_used:", profile.ai_creatives_used);
    console.log("  ai_ad_optimizations_used:", profile.ai_ad_optimizations_used);
    console.log("  remarketing_campaigns_used:", profile.remarketing_campaigns_used);
    console.log("  seo_articles_used:", profile.seo_articles_used);
    console.log("  campaign_launches_used:", profile.campaign_launches_used);

    console.log("\nResetting counts and upgrading plan to agency (or growth) to give more quota...");
    
    const { data: updated, error: updateError } = await supabase
        .from('profiles')
        .update({
            subscription_plan: 'agency', // Upgrade to agency plan which gives higher/unlimited quota limits
            ai_creatives_used: 0,
            ai_ad_optimizations_used: 0,
            remarketing_campaigns_used: 0,
            seo_articles_used: 0,
            campaign_launches_used: 0,
            usage_reset_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        })
        .eq('id', targetUserId)
        .select()
        .single();

    if (updateError) {
        console.error("Update Error:", updateError);
        return;
    }

    console.log("\nUPDATED STATE SUCCESSFUL:");
    console.log("  subscription_plan:", updated.subscription_plan);
    console.log("  ai_creatives_used:", updated.ai_creatives_used);
}

run().catch(console.error);
