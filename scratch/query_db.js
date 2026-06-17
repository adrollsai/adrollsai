const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== Querying Realty Nation Profile Fields ===");
    const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', 'c890a11f-84ce-4592-ab8f-8682927b1a9d')
        .single();
    
    if (error || !profile) {
        console.error("Failed to load profile:", error);
        return;
    }

    console.log("Profile Data:", {
        id: profile.id,
        business_name: profile.business_name,
        pixel_id: profile.pixel_id,
        created_at: profile.created_at,
        updated_at: profile.updated_at
    });
}

run().catch(console.error);
