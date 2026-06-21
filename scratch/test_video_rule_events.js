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
    const videoId = '1723490788888503';

    // Experiment 11: event = video_completed (Meta's term for 95% watch time)
    await test("Experiment 11: value = video_completed", {
        name: `Test Experiment 11 - ${Date.now()}`,
        subtype: "VIDEO",
        rule: JSON.stringify({
            inclusions: {
                operator: "or",
                rules: [{
                    event_sources: [{ id: videoId, type: "video" }],
                    retention_seconds: 31536000,
                    filter: {
                        operator: "and",
                        filters: [{ field: "event", operator: "eq", value: "video_completed" }]
                    }
                }]
            }
        })
    });

    // Experiment 12: event = video_view_75_percent
    await test("Experiment 12: value = video_view_75_percent", {
        name: `Test Experiment 12 - ${Date.now()}`,
        subtype: "VIDEO",
        rule: JSON.stringify({
            inclusions: {
                operator: "or",
                rules: [{
                    event_sources: [{ id: videoId, type: "video" }],
                    retention_seconds: 31536000,
                    filter: {
                        operator: "and",
                        filters: [{ field: "event", operator: "eq", value: "video_view_75_percent" }]
                    }
                }]
            }
        })
    });

    // Experiment 13: event = video_view_95_percent
    await test("Experiment 13: value = video_view_95_percent", {
        name: `Test Experiment 13 - ${Date.now()}`,
        subtype: "VIDEO",
        rule: JSON.stringify({
            inclusions: {
                operator: "or",
                rules: [{
                    event_sources: [{ id: videoId, type: "video" }],
                    retention_seconds: 31536000,
                    filter: {
                        operator: "and",
                        filters: [{ field: "event", operator: "eq", value: "video_view_95_percent" }]
                    }
                }]
            }
        })
    });
}

run().catch(console.error);
