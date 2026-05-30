require('dotenv').config({ path: '.env.local' });
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const userId = "bc63c065-9bcc-4793-bedc-f0960406425b";

async function run() {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('character_url, character_description')
            .eq('id', userId)
            .single();

        if (error) {
            console.error("Supabase Error:", error);
            return;
        }

        console.log("Current character_url in profile:", data.character_url);
        console.log("Current character_description:", data.character_description);
    } catch (e) {
        console.error(e);
    }
}

run();
