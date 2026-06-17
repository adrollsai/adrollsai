const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== Attempting to update database schema ===");
    
    // 1. Add pixel_id to landing_pages
    const sql_landing_pages = "ALTER TABLE public.landing_pages ADD COLUMN IF NOT EXISTS pixel_id TEXT;";
    console.log(`Running SQL for landing_pages: ${sql_landing_pages}`);
    
    const { error: err1 } = await supabaseAdmin.rpc('run_sql', { sql_query: sql_landing_pages });
    if (err1) {
        console.error("Error adding column to landing_pages via RPC 'run_sql':", err1);
    } else {
        console.log("✅ Successfully added pixel_id to landing_pages table!");
    }

    // 2. Add pixel_id to leads
    const sql_leads = "ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS pixel_id TEXT;";
    console.log(`Running SQL for leads: ${sql_leads}`);
    
    const { error: err2 } = await supabaseAdmin.rpc('run_sql', { sql_query: sql_leads });
    if (err2) {
        console.error("Error adding column to leads via RPC 'run_sql':", err2);
    } else {
        console.log("✅ Successfully added pixel_id to leads table!");
    }
}

run().catch(console.error);
