const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

async function run() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error("❌ Error: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
        process.exit(1);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const sql = `ALTER TABLE properties ADD COLUMN IF NOT EXISTS youtube_url TEXT DEFAULT NULL;`;
    
    console.log("🚀 Running SQL query to add youtube_url column to properties table...");
    const { data, error } = await supabase.rpc('run_sql', { sql_query: sql });

    if (error) {
        console.error("❌ SQL execution failed:", error);
        process.exit(1);
    }

    console.log("✅ Column youtube_url added successfully to properties table!", data);
}

run();
