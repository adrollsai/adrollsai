const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const TARGET_EMAIL = 'adrolls-realty-demo@adrolls.in';

async function run() {
    console.log("=== Updating Demo Account Features ===");

    // 1. Find the user ID
    const { data: profiles, error: findErr } = await supabaseAdmin
        .from('profiles')
        .select('id, role, business_name')
        .eq('email', TARGET_EMAIL);
    
    if (findErr || !profiles || profiles.length === 0) {
        console.error("Could not find demo profile:", findErr);
        return;
    }

    const demoUserId = profiles[0].id;
    console.log(`Found demo user ID: ${demoUserId}, current role: ${profiles[0].role}`);

    // 2. Update role to 'agency' to enable the Landing Page Builder tab ("Pages") natively
    const { error: updateProfileErr } = await supabaseAdmin
        .from('profiles')
        .update({
            role: 'agency',
            enable_distribution: true
        })
        .eq('id', demoUserId);
    
    if (updateProfileErr) {
        console.error("Failed to update profile role:", updateProfileErr);
    } else {
        console.log("Updated profile role to 'agency' and enabled distribution.");
    }

    // 3. Update all properties to set auto_generate = true (enables the video toggle)
    const { error: updatePropErr } = await supabaseAdmin
        .from('properties')
        .update({ auto_generate: true })
        .eq('user_id', demoUserId);
    
    if (updatePropErr) {
        console.error("Failed to enable video toggle (auto_generate = true) for properties:", updatePropErr);
    } else {
        console.log("Successfully enabled video toggle (auto_generate = true) on all demo properties.");
    }

    console.log("=== Demo Account Update Complete ===");
}

run().catch(console.error);
