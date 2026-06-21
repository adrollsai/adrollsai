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

    // Experiment 7: rule is flat array (Legacy rules array directly)
    await test("Experiment 7: rule is flat rules array", {
        name: `Test Experiment 7 - ${Date.now()}`,
        subtype: "VIDEO",
        rule: JSON.stringify([
            {
                event_sources: [{ id: videoId, type: "video" }],
                retention_seconds: 31536000,
                filter: {
                    operator: "and",
                    filters: [{ field: "event", operator: "eq", value: "video_watched_95_percent" }]
                }
            }
        ])
    });

    // Experiment 8: rule has rules array directly (no inclusions wrapper)
    await test("Experiment 8: rule is rules: [...] directly", {
        name: `Test Experiment 8 - ${Date.now()}`,
        subtype: "VIDEO",
        rule: JSON.stringify({
            rules: [
                {
                    event_sources: [{ id: videoId, type: "video" }],
                    retention_seconds: 31536000,
                    filter: {
                        operator: "and",
                        filters: [{ field: "event", operator: "eq", value: "video_watched_95_percent" }]
                    }
                }
            ]
        })
    });

    // Experiment 9: flat rules array with event=video_watch_time + value=95_percent
    await test("Experiment 9: flat rules array with event=video_watch_time + value=95_percent", {
        name: `Test Experiment 9 - ${Date.now()}`,
        subtype: "VIDEO",
        rule: JSON.stringify([
            {
                event_sources: [{ id: videoId, type: "video" }],
                retention_seconds: 31536000,
                filter: {
                    operator: "and",
                    filters: [
                        { field: "event", operator: "eq", value: "video_watch_time" },
                        { field: "value", operator: "eq", value: "95_percent" }
                    ]
                }
            }
        ])
    });

    // Experiment 10: rules direct with event=video_watch_time + value=95_percent
    await test("Experiment 10: rules direct with event=video_watch_time + value=95_percent", {
        name: `Test Experiment 10 - ${Date.now()}`,
        subtype: "VIDEO",
        rule: JSON.stringify({
            rules: [
                {
                    event_sources: [{ id: videoId, type: "video" }],
                    retention_seconds: 31536000,
                    filter: {
                        operator: "and",
                        filters: [
                            { field: "event", operator: "eq", value: "video_watch_time" },
                            { field: "value", operator: "eq", value: "95_percent" }
                        ]
                    }
                }
            ]
        })
    });
}

run().catch(console.error);
