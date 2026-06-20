const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const userId = "c890a11f-84ce-4592-ab8f-8682927b1a9d"; // Realty Nation

async function run() {
    console.log("=== Querying Realty Nation Profile ===");
    const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('id, business_name, character_url, character_description, character_audio_url, avatar_url, avatar_description, avatar_audio_url')
        .eq('id', userId)
        .single();

    if (error) {
        console.error("Error:", error);
        return;
    }

    console.log("Profile details:");
    console.log(JSON.stringify(profile, null, 2));
}

run().catch(console.error);
