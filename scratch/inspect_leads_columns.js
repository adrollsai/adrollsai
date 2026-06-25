const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== INSPECTING LEADS TABLE COLUMNS ===");
    const { data, error } = await supabaseAdmin
        .from('leads')
        .select('*')
        .limit(1);
        
    if (error) {
        console.error("Error:", error);
    } else if (data && data.length > 0) {
        console.log("Columns:", Object.keys(data[0]));
        console.log("Sample lead record:", JSON.stringify(data[0], null, 2));
    } else {
        console.log("No records found in leads table.");
    }
}

run().catch(console.error);
