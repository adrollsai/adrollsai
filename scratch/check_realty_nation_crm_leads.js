const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const userId = 'c890a11f-84ce-4592-ab8f-8682927b1a9d'; // Realty Nation
    console.log("=== Querying CRM Leads for Realty Nation ===");
    const { data: leads, error } = await supabaseAdmin
        .from('leads')
        .select('id, name, email, phone, source, pipeline_stage, facebook_lead_id, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);
    
    if (error) {
        console.error("Supabase Error:", error);
        return;
    }

    console.log(`Found ${leads.length} leads in CRM:`);
    leads.forEach((l) => {
        console.log(`- Lead: ${l.name} | Email: ${l.email} | Phone: ${l.phone}`);
        console.log(`  Source: ${l.source} | Facebook Lead ID: ${l.facebook_lead_id}`);
        console.log(`  Created At: ${l.created_at} | Stage: ${l.pipeline_stage}`);
    });
}

run().catch(console.error);
