const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("Loading specific profiles...");
    const targets = [
        '42d2e0c5-4fe6-4738-8a9f-63f09be01f12', // GNR HOMES
        'c890a11f-84ce-4592-ab8f-8682927b1a9d', // Realty Nation
        '29937131-1975-4c5f-9b78-e5b28f918d32'  // The ProEstate
    ];

    const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('id, business_name, facebook_token, ad_account_id, selected_page_id, selected_page_token, selected_page_name')
        .in('id', targets);

    if (error) {
        console.error("Query Error:", error);
        return;
    }

    profiles.forEach(p => {
        console.log(`\n--- Profile: ${p.business_name} (${p.id}) ---`);
        console.log(`facebook_token (first 12 chars): ${p.facebook_token ? p.facebook_token.substring(0, 12) + '...' : 'none'}`);
        console.log(`selected_page_id: ${p.selected_page_id}`);
        console.log(`selected_page_token (first 12 chars): ${p.selected_page_token ? p.selected_page_token.substring(0, 12) + '...' : 'none'}`);
        console.log(`selected_page_name: ${p.selected_page_name}`);
    });
}

run().catch(console.error);
