const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const ids = [
        '59cd329c-c1f5-45e1-9d41-a0642d5132f4', // Aparna
        '29937131-1975-4c5f-9b78-e5b28f918d32'  // The ProEstate
    ];

    for (const id of ids) {
        const { data: profile, error } = await supabaseAdmin
            .from('profiles')
            .select('id, email, business_name, subscription_plan, addon_videos, ai_creatives_used')
            .eq('id', id)
            .single();

        if (error) {
            console.error(`Error querying ${id}:`, error.message);
        } else {
            console.log(`\nAccount: ${profile.business_name} (${profile.email})`);
            console.log(`  ID: ${profile.id}`);
            console.log(`  Subscription Plan: ${profile.subscription_plan}`);
            console.log(`  Addon Videos: ${profile.addon_videos}`);
            console.log(`  AI Creatives Used: ${profile.ai_creatives_used}`);
        }
    }
}

run().catch(console.error);
