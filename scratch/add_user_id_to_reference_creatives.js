const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== Attempting to update database schema for reference_creatives ===");
    
    const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260619120000_add_user_id_to_reference_creatives.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log("Executing SQL migration script...");
    const { data, error } = await supabaseAdmin.rpc('exec_sql', { query: sql });
    
    if (error) {
        console.error("❌ Migration failed:", error);
    } else {
        console.log("✅ Migration applied successfully!");
    }
}

run().catch(console.error);
