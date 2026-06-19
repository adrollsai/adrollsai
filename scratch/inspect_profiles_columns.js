const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .limit(1)
        .single();

    if (error) {
        console.error("Error fetching profiles row:", error.message);
    } else {
        console.log("Profiles Columns/Keys:");
        console.log(Object.keys(profile).sort().join('\n'));
    }
}

run().catch(console.error);
