const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== INSPECTING CAMPAIGNS TABLE COLUMNS ===");
    const { data, error } = await supabaseAdmin
        .from('campaigns')
        .select('*')
        .limit(1);
        
    if (error) {
        console.error("Error:", error);
    } else if (data && data.length > 0) {
        console.log("Columns:", Object.keys(data[0]));
        console.log("Sample campaign record:", JSON.stringify(data[0], null, 2));
    } else {
        // If no records, let's query the postgres tables columns directly using RPC run_sql or select columns of any record
        console.log("No records found in campaigns table. Trying to fetch columns from information_schema if possible...");
        const { data: cols, error: colErr } = await supabaseAdmin
            .from('campaigns')
            .select()
            .limit(0);
        if (colErr) {
            console.error("Error fetching schema:", colErr);
        } else {
            console.log("Columns from empty select:", cols);
        }
    }
}

run().catch(console.error);
