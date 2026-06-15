const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    console.log("=== ALL LEADS IN APPOINTMENT BOOKED STAGE ===");
    const { data: leads, error } = await supabaseAdmin
        .from('leads')
        .select('id, name, email, pipeline_stage, booked_time, created_at')
        .eq('pipeline_stage', 'Appointment booked')
        .order('created_at', { ascending: false });
    
    if (error) {
        console.error(error);
        return;
    }
    console.log(JSON.stringify(leads, null, 2));
}

run().catch(console.error);
