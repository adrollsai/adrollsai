const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("Adding page_type column to landing_pages...");
    const sql = `
        ALTER TABLE public.landing_pages ADD COLUMN IF NOT EXISTS page_type TEXT DEFAULT 'standard';
    `;
    const { data, error } = await supabaseAdmin.rpc('run_sql', { sql_query: sql });
    
    if (error) {
        console.error("RPC Error:", error);
    } else {
        console.log("Success! RPC Result:", data);
    }
}

run().catch(console.error);
