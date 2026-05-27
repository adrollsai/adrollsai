const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing Supabase credentials in .env.local");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkProfile() {
    const targetUserId = '2f62a259-f23b-48ee-a920-c436f36eaa4b';
    const { data, error } = await supabase
        .from('profiles')
        .select('id, business_name, role, character_url, character_description')
        .eq('id', targetUserId)
        .single();

    if (error) {
        console.error("Error fetching profile:", error);
    } else {
        console.log("=== Target Profile ===");
        console.log(JSON.stringify(data, null, 2));
    }
}

checkProfile();
