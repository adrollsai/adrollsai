const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
    console.log(`=== RECENT CRM LEADS FOR ${userId} ===`);
    
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    const { data: leads, error } = await supabaseAdmin
        .from('leads')
        .select('id, name, email, phone, source, ad_name, facebook_lead_id, created_at, pixel_id')
        .eq('user_id', userId)
        .gte('created_at', tenDaysAgo.toISOString())
        .order('created_at', { ascending: false });
    
    if (error) {
        console.error(error);
        return;
    }
    
    console.log(`Found ${leads.length} leads in the last 10 days:`);
    leads.forEach((l, idx) => {
        console.log(`${idx + 1}. [${l.created_at}] Name: "${l.name}" | Email: "${l.email}" | Phone: "${l.phone}" | Source: "${l.source}" | Ad: "${l.ad_name}" | FB Lead ID: ${l.facebook_lead_id} | Pixel ID: ${l.pixel_id}`);
    });
}

run().catch(console.error);
