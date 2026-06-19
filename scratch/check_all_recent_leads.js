const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== ALL LEADS DATABASE SCAN (SINCE June 17, 2026) ===");
    
    const { data: leads, error } = await supabaseAdmin
        .from('leads')
        .select('id, user_id, name, email, phone, source, ad_name, facebook_lead_id, created_at, pixel_id')
        .gte('created_at', '2026-06-17T00:00:00.000Z')
        .order('created_at', { ascending: false });
    
    if (error) {
        console.error(error);
        return;
    }
    
    console.log(`Found ${leads.length} total leads in database since June 17:`);
    leads.forEach((l, idx) => {
        console.log(`${idx + 1}. [User: ${l.user_id}] [${l.created_at}] Name: "${l.name}" | Email: "${l.email}" | Phone: "${l.phone}" | Source: "${l.source}" | Ad: "${l.ad_name}" | FB Lead ID: ${l.facebook_lead_id} | Pixel ID: ${l.pixel_id}`);
    });
}

run().catch(console.error);
