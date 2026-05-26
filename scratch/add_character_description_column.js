const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("Attempting to add column 'character_description' to 'profiles' table...");
    
    // We try to use the common 'run_sql' RPC which is sometimes set up to run administrative queries in Supabase UAT/Dev environments.
    const { data, error } = await supabaseAdmin.rpc('run_sql', {
        sql_query: "ALTER TABLE profiles ADD COLUMN IF NOT EXISTS character_description TEXT;"
    });

    if (error) {
        console.error("RPC 'run_sql' failed or does not exist:", error.message);
        console.log("Please add this column manually in your Supabase SQL Editor:\n\nALTER TABLE profiles ADD COLUMN IF NOT EXISTS character_description TEXT;");
    } else {
        console.log("Successfully added column 'character_description' to 'profiles' table via RPC!");
    }
}

run().catch(console.error);
