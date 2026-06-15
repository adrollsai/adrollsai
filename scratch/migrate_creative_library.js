const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');

async function run() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error("❌ Error: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
        process.exit(1);
    }

    console.log(`🔌 Connecting to Supabase: ${supabaseUrl}`);
    const supabase = createClient(supabaseUrl, supabaseKey);

    const sqlPath = path.join(__dirname, '../supabase/migrations/20260614144500_create_reference_creatives.sql');
    if (!fs.existsSync(sqlPath)) {
        console.error(`❌ SQL migration file not found at: ${sqlPath}`);
        process.exit(1);
    }

    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    console.log("🚀 Executing SQL migration script via RPC 'run_sql'...");

    const { data, error } = await supabase.rpc('run_sql', { sql_query: sqlContent });

    if (error) {
        console.error("❌ Migration failed:", error);
        process.exit(1);
    }

    console.log("✅ Migration completed successfully! Tables created and RLS policies deployed.");
}

run().catch(err => {
    console.error("!!! UNCAUGHT ERROR !!!", err);
    process.exit(1);
});
