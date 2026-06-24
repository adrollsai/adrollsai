const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const clients = [
        { name: 'Realty Nation', id: 'c890a11f-84ce-4592-ab8f-8682927b1a9d' },
        { name: 'GNR Homes', id: '42d2e0c5-4fe6-4738-8a9f-63f09be01f12' },
        { name: 'The ProEstate', id: '29937131-1975-4c5f-9b78-e5b28f918d32' }
    ];

    for (const client of clients) {
        console.log(`\n======================================================`);
        console.log(`Leads in DB for ${client.name} (after 2026-06-20)`);
        console.log(`======================================================`);

        const { data: leads, error } = await supabaseAdmin
            .from('leads')
            .select('id, name, form_id, form_name, ad_name, facebook_lead_id, created_at')
            .eq('user_id', client.id)
            .gte('created_at', '2026-06-20T00:00:00Z');

        if (error) {
            console.error("Error fetching leads:", error);
            continue;
        }

        console.log(`Found ${leads.length} leads in database:`);
        leads.forEach(l => {
            console.log(`- Name: ${l.name} | Form: ${l.form_name} (ID: ${l.form_id}) | Ad: ${l.ad_name} | FB Lead ID: ${l.facebook_lead_id} | Created: ${l.created_at}`);
        });
    }
}

run().catch(console.error);
