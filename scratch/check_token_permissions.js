const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";

async function run() {
    console.log("Loading target profiles...");
    const targets = [
        '42d2e0c5-4fe6-4738-8a9f-63f09be01f12', // GNR HOMES
        'c890a11f-84ce-4592-ab8f-8682927b1a9d', // Realty Nation
        '29937131-1975-4c5f-9b78-e5b28f918d32'  // The ProEstate
    ];

    const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('id, business_name, facebook_token, selected_page_token')
        .in('id', targets);

    if (error) {
        console.error("Query Error:", error);
        return;
    }

    for (const p of profiles) {
        console.log(`\n=== Permissions for "${p.business_name}" ===`);
        if (!p.facebook_token) {
            console.log("⚠️ No facebook token!");
            continue;
        }

        try {
            const url = `${FB_MARKETING_URL}/me/permissions?access_token=${p.facebook_token}`;
            const res = await fetch(url);
            const data = await res.json();

            if (data.error) {
                console.error("❌ Meta permissions check failed:", data.error.message);
                continue;
            }

            const permissions = data.data || [];
            console.log(`Granted Permissions (${permissions.length}):`);
            const activePerms = permissions.filter(perm => perm.status === 'granted').map(perm => perm.permission);
            console.log(JSON.stringify(activePerms));

            // Check specifically for pages_manage_metadata
            if (activePerms.includes('pages_manage_metadata')) {
                console.log("✅ pages_manage_metadata is GRANTED!");
            } else {
                console.log("🚨 pages_manage_metadata is MISSING!");
            }

            if (activePerms.includes('leads_retrieval')) {
                console.log("✅ leads_retrieval is GRANTED!");
            } else {
                console.log("🚨 leads_retrieval is MISSING!");
            }
        } catch (e) {
            console.error("Fetch failed:", e.message);
        }
    }
}

run().catch(console.error);
