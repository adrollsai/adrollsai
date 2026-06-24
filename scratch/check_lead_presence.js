const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const testIds = [
        '1962364887782827', // Sunil sharma
        '1292873512624177', // Anil singh
        '2573258573143386', // Anil singh (form 2)
        '1321226866865680'  // Jai guru ji
    ];

    console.log("Checking specific leads presence in CRM database:");
    const { data: leads, error } = await supabaseAdmin
        .from('leads')
        .select('id, user_id, name, email, phone, facebook_lead_id, created_at')
        .in('facebook_lead_id', testIds);

    if (error) {
        console.error("Error:", error);
        return;
    }

    console.log(`Found ${leads.length} matching leads in the database:`);
    leads.forEach(l => {
        console.log(`- ID: ${l.id} | UserID: ${l.user_id} | Name: ${l.name} | FB Lead ID: ${l.facebook_lead_id} | Created: ${l.created_at}`);
    });
}

run().catch(console.error);
