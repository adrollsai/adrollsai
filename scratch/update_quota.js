const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const subId = '42d2e0c5-4fe6-4738-8a9f-63f09be01f12';
    console.log(`=== UPDATING QUOTA FOR SUBACCOUNT: ${subId} ===`);
    
    const { data, error } = await supabaseAdmin
        .from('profiles')
        .update({
            subscription_plan: 'pro',
            ai_creatives_used: 0,
            ai_ad_optimizations_used: 0,
            remarketing_campaigns_used: 0,
            seo_articles_used: 0,
            campaign_launches_used: 0,
            usage_reset_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days from now
        })
        .eq('id', subId)
        .select()
        .single();
        
    if (error) {
        console.error("Update Error:", error);
    } else {
        console.log("Update Successful! New profile state:");
        console.log(JSON.stringify(data, null, 2));
    }
}

run().catch(console.error);
