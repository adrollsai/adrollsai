const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const targetUserId = '29937131-1975-4c5f-9b78-e5b28f918d32';

async function run() {
    console.log("Upgrading The ProEstate to Enterprise plan...");
    const { data: updated, error } = await supabaseAdmin
        .from('profiles')
        .update({
            subscription_plan: 'enterprise',
            ai_creatives_used: 0,
            campaign_launches_used: 0,
            ai_ad_optimizations_used: 0,
            remarketing_campaigns_used: 0,
            seo_articles_used: 0,
            usage_reset_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        })
        .eq('id', targetUserId)
        .select()
        .single();

    if (error) {
        console.error("❌ Upgrade failed:", error.message);
    } else {
        console.log("✅ Successfully upgraded The ProEstate to Enterprise!");
        console.log("Updated Plan:", updated.subscription_plan);
    }
}

run().catch(console.error);
