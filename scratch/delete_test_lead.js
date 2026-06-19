const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const leadId = '2a9df3d3-1f2e-4fe1-8584-280fe735842c';
    console.log(`Cleaning up test lead ID: ${leadId}...`);
    
    const { error: histErr } = await supabaseAdmin
        .from('lead_history')
        .delete()
        .eq('lead_id', leadId);
        
    if (histErr) {
        console.error("Error deleting history:", histErr);
    }

    const { error: leadErr } = await supabaseAdmin
        .from('leads')
        .delete()
        .eq('id', leadId);
        
    if (leadErr) {
        console.error("Error deleting lead:", leadErr);
    } else {
        console.log("✅ Test lead cleaned up successfully.");
    }
}

run().catch(console.error);
