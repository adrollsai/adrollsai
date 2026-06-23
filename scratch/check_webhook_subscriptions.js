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
        .select('id, business_name, selected_page_id, selected_page_token')
        .in('id', targets);

    if (error) {
        console.error("Query Error:", error);
        return;
    }

    for (const p of profiles) {
        console.log(`\n=== Checking Page: "${p.business_name}" (ID: ${p.selected_page_id}) ===`);
        if (!p.selected_page_id || !p.selected_page_token) {
            console.log("⚠️ Missing page ID or token in database!");
            continue;
        }

        try {
            const url = `${FB_MARKETING_URL}/${p.selected_page_id}/subscribed_apps?access_token=${p.selected_page_token}`;
            const res = await fetch(url);
            const data = await res.json();

            if (data.error) {
                console.error("❌ Meta Graph API Error:", data.error.message);
                continue;
            }

            console.log("Subscribed Apps response from Meta:", JSON.stringify(data, null, 2));

            // Check if our app is in the list
            const appList = data.data || [];
            if (appList.length === 0) {
                console.log("🚨 NOT SUBSCRIBED: This page is not subscribed to any apps!");
            } else {
                const leadgenField = appList.find(app => app.subscribed_fields && app.subscribed_fields.includes('leadgen'));
                if (leadgenField) {
                    console.log("✅ SUBSCRIBED: Page is successfully subscribed to app webhooks for 'leadgen' field!");
                } else {
                    console.log("🚨 PARTIAL/NO FIELD: App is connected, but 'leadgen' field is not subscribed!", appList);
                }
            }
        } catch (e) {
            console.error("API call failed:", e.message);
        }
    }
}

run().catch(console.error);
