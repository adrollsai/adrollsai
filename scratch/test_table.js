const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("Checking if reference_creatives table exists...");
    const { data, error } = await supabaseAdmin
        .from('reference_creatives')
        .select('*')
        .limit(1);

    if (error) {
        console.error("❌ Table check failed:", error);
    } else {
        console.log("✅ Table exists!", data);
    }
}

run().catch(console.error);
