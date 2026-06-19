const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const leadId = '2a9df3d3-1f2e-4fe1-8584-280fe735842c';
    console.log(`Checking Lead ID: ${leadId} in database...`);
    const { data: lead, error } = await supabaseAdmin
        .from('leads')
        .select('*')
        .eq('id', leadId)
        .maybeSingle();
        
    if (error) {
        console.error(error);
        return;
    }
    
    if (lead) {
        console.log("✅ Lead found in database!");
        console.log(JSON.stringify(lead, null, 2));
    } else {
        console.log("❌ Lead NOT found in database.");
    }
}

run().catch(console.error);
