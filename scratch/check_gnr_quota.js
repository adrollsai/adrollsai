const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("Fetching GNR HOMES and parent/agent info...");
    const gnrAdminId = '42d2e0c5-4fe6-4738-8a9f-63f09be01f12';
    
    const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', gnrAdminId)
        .single();
        
    if (error) {
        console.error("Error fetching admin:", error);
        return;
    }

    console.log("Admin ID:", profile.id);
    console.log("Email:", profile.email);
    console.log("Business Name:", profile.business_name);
    console.log("Subscription Plan:", profile.subscription_plan);
    console.log("ai_creatives_used:", profile.ai_creatives_used);
    console.log("videos_used:", profile.videos_used);
    console.log("addon_videos:", profile.addon_videos);
    
    // Check if there are columns like videos_used, images_used, etc.
    console.log("All numeric usage/limit fields in profile:");
    for (const [k, v] of Object.entries(profile)) {
        if (typeof v === 'number' || k.includes('used') || k.includes('addon') || k.includes('limit')) {
            console.log(`  ${k}: ${v}`);
        }
    }
}

run().catch(console.error);
