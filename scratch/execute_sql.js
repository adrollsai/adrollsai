const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== EXECUTING SQL VIA run_sql RPC ===");
    const query = "SELECT policyname, definition FROM pg_policies WHERE tablename = 'assets';";
    const { data, error } = await supabaseAdmin.rpc('run_sql', {
        sql_query: query
    });

    if (error) {
        console.error("RPC Error:", error);
    } else {
        console.log("Result:", JSON.stringify(data, null, 2));
    }
}

run().catch(console.error);
