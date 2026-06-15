const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== MOST RECENT LEADS ===");
    const { data: leads, error } = await supabaseAdmin
        .from('leads')
        .select('id, name, email, pipeline_stage, booked_time, created_at')
        .order('created_at', { ascending: false })
        .limit(5);
    
    if (error) {
        console.error(error);
        return;
    }
    console.log(JSON.stringify(leads, null, 2));
}

run().catch(console.error);
