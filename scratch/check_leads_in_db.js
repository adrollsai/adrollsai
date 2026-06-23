const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("Checking database leads...");
    const targets = {
        '42d2e0c5-4fe6-4738-8a9f-63f09be01f12': 'GNR HOMES',
        'c890a11f-84ce-4592-ab8f-8682927b1a9d': 'Realty Nation',
        '29937131-1975-4c5f-9b78-e5b28f918d32': 'The ProEstate'
    };

    for (const [userId, name] of Object.entries(targets)) {
        const { data: leads, error } = await supabaseAdmin
            .from('leads')
            .select('id, name, email, phone, source, created_at, form_name, ad_name')
            .eq('user_id', userId);
            
        if (error) {
            console.error(`Error checking leads for ${name}:`, error);
            continue;
        }

        console.log(`\n=== DB Leads for ${name} (Total: ${leads.length}) ===`);
        if (leads.length > 0) {
            // Print the last 5 leads
            const lastLeads = leads.slice(-5);
            lastLeads.forEach(l => {
                console.log(`- Created: ${l.created_at} | Name: "${l.name}" | Source: "${l.source}" | Form: "${l.form_name}" | Ad: "${l.ad_name}"`);
            });
        } else {
            console.log("No leads found in DB.");
        }
    }
}

run().catch(console.error);
