const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function test(name, payload) {
    console.log(`\n--- Testing: ${name} ---`);
    try {
        const { data: prof } = await supabase.from('profiles').select('facebook_token, ad_account_id').eq('id', '2b0312dc-c1fc-4798-ab1c-339939271229').single();
        const res = await fetch(`https://graph.facebook.com/v19.0/${prof.ad_account_id}/customaudiences`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...payload,
                access_token: prof.facebook_token
            })
        });
        const resData = await res.json();
        console.log("Response:", JSON.stringify(resData, null, 2));
    } catch (e) {
        console.error("Exception:", e.message);
    }
}

async function run() {
    const formId = '962583836485360'; // Lead form ID from meta_ads_debug.txt

    // Experiment 17: Nested inclusions/rules format for lead gen form
    await test("Experiment 17: Nested inclusions/rules format for Lead Form", {
        name: `Test Experiment 17 - ${Date.now()}`,
        rule: JSON.stringify({
            inclusions: {
                operator: "or",
                rules: [
                    {
                        event_sources: [{ id: formId, type: "lead_gen" }],
                        retention_seconds: 7776000,
                        filter: {
                            operator: "and",
                            filters: [{ field: "event", operator: "eq", value: "opened_form" }]
                        }
                    }
                ]
            }
        })
    });

    // Experiment 18: Flat engagement format for Lead Form
    await test("Experiment 18: Flat engagement format for Lead Form", {
        name: `Test Experiment 18 - ${Date.now()}`,
        subtype: "ENGAGEMENT",
        rule: JSON.stringify([
            {
                event_name: "opened_form",
                object_id: formId
            }
        ])
    });
}

run().catch(console.error);
