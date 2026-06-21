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
    const formId = '962583836485360';
    const pageId = '729422193595388';

    // Test A: type = lead_gen, event = lead_generation_opened
    await test("Test A: event_sources type=lead_gen, event=lead_generation_opened", {
        name: `Test Lead Gen Nested A - ${Date.now()}`,
        rule: JSON.stringify({
            inclusions: {
                operator: "or",
                rules: [
                    {
                        event_sources: [{ id: formId, type: "lead_gen" }],
                        retention_seconds: 7776000,
                        filter: {
                            operator: "and",
                            filters: [{ field: "event", operator: "eq", value: "lead_generation_opened" }]
                        }
                    }
                ]
            }
        })
    });

    // Test B: type = page, event = lead_generation_opened, form_id filter
    await test("Test B: event_sources type=page, event=lead_generation_opened, form_id filter", {
        name: `Test Lead Gen Nested B - ${Date.now()}`,
        rule: JSON.stringify({
            inclusions: {
                operator: "or",
                rules: [
                    {
                        event_sources: [{ id: pageId, type: "page" }],
                        retention_seconds: 7776000,
                        filter: {
                            operator: "and",
                            filters: [
                                { field: "event", operator: "eq", value: "lead_generation_opened" },
                                { field: "form_id", operator: "eq", value: formId }
                            ]
                        }
                    }
                ]
            }
        })
    });

    // Test C: type = page, event = lead_generation_submitted, form_id filter
    await test("Test C: event_sources type=page, event=lead_generation_submitted, form_id filter", {
        name: `Test Lead Gen Nested C - ${Date.now()}`,
        rule: JSON.stringify({
            inclusions: {
                operator: "or",
                rules: [
                    {
                        event_sources: [{ id: pageId, type: "page" }],
                        retention_seconds: 7776000,
                        filter: {
                            operator: "and",
                            filters: [
                                { field: "event", operator: "eq", value: "lead_generation_submitted" },
                                { field: "form_id", operator: "eq", value: formId }
                            ]
                        }
                    }
                ]
            }
        })
    });
}

run().catch(console.error);
