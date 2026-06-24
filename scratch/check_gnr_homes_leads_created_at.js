const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const userId = '42d2e0c5-4fe6-4738-8a9f-63f09be01f12'; // GNR HOMES
    const { data: leads, error } = await supabaseAdmin
        .from('leads')
        .select('id, name, email, phone, source, facebook_lead_id, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error(error);
        return;
    }

    console.log(`GNR Homes leads in CRM (${leads.length}):`);
    leads.forEach(l => {
        console.log(`- Lead: ${l.name} | Source: ${l.source} | FB ID: ${l.facebook_lead_id} | Created At: ${l.created_at}`);
    });
}

run().catch(console.error);
