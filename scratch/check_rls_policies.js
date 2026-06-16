const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("Querying database schema for RLS policies...");
    
    // We can query pg_policies to see active RLS policies!
    const { data: policies, error } = await supabaseAdmin.rpc('exec_sql', {
        query: "SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check FROM pg_policies WHERE tablename = 'profiles';"
    });

    if (error) {
        // If exec_sql RPC doesn't exist, let's query it via normal sql or check if we have any other rpc
        console.error("RPC Error:", error.message);
        
        // Let's try executing SQL directly using raw query if possible, or print standard information
        console.log("Attempting direct select from a system view or listing other schema details...");
    } else {
        console.log("RLS Policies for 'properties':");
        console.log(JSON.stringify(policies, null, 2));
    }
}

run().catch(console.error);
