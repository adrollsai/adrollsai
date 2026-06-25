const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const leadIds = [
    // Realty Nation
    '120249015633660295', // Campaign ID
    // GNR Homes
    '52547215473044',
    // The ProEstate
    '120248729046110642'
];

async function run() {
    console.log("=== Querying Lead Details from CRM ===");
    
    // We will query the CRM for the facebook_lead_ids we know were fetched from the latest campaigns.
    // Let's first query the leads for each sub-account.
    
    const subaccounts = [
        { name: 'Realty Nation', userId: 'c890a11f-84ce-4592-ab8f-8682927b1a9d' },
        { name: 'GNR Homes', userId: '42d2e0c5-4fe6-4738-8a9f-63f09be01f12' },
        { name: 'The ProEstate', userId: '29937131-1975-4c5f-9b78-e5b28f918d32' }
    ];
    
    for (const sub of subaccounts) {
        console.log(`\nLeads for ${sub.name}:`);
        const { data: leads, error } = await supabaseAdmin
            .from('leads')
            .select('id, name, email, phone, ad_name, facebook_lead_id, created_at')
            .eq('user_id', sub.userId)
            .order('created_at', { ascending: false })
            .limit(10);
            
        if (error) {
            console.error("Error:", error);
            continue;
        }
        
        leads.forEach(l => {
            console.log(`- Name: ${l.name} | Phone: ${l.phone} | Email: ${l.email || 'N/A'} | Ad Name: ${l.ad_name || 'N/A'} | CRM ID: ${l.id} | FB ID: ${l.facebook_lead_id} | Created: ${l.created_at}`);
        });
    }
}

run().catch(console.error);
