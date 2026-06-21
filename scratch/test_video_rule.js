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
    
    // Experiment 2: subtype ENGAGEMENT, event_sources: [{id: videoId, type: "video"}]
    // Rule: filter: { field: "event", operator: "eq", value: "video_watched_95_percent" }
    await test("Experiment 2: subtype ENGAGEMENT, type: video, value: video_watched_95_percent", {
        name: `Test Experiment 2 - ${Date.now()}`,
        subtype: "ENGAGEMENT",
        rule: JSON.stringify({
            inclusions: {
                operator: "or",
                rules: [{
                    event_sources: [{ id: videoId, type: "video" }],
                    retention_seconds: 31536000,
                    filter: {
                        operator: "and",
                        filters: [{ field: "event", operator: "eq", value: "video_watched_95_percent" }]
                    }
                }]
            }
        })
    });

    // Experiment 3: subtype VIDEO, event_sources: [{id: videoId, type: "video"}]
    // Rule: filter: { field: "video_watch_time", operator: "eq", value: 95 }
    await test("Experiment 3: subtype VIDEO, field: video_watch_time, value: 95", {
        name: `Test Experiment 3 - ${Date.now()}`,
        subtype: "VIDEO",
        rule: JSON.stringify({
            inclusions: {
                operator: "or",
                rules: [{
                    event_sources: [{ id: videoId, type: "video" }],
                    retention_seconds: 31536000,
                    filter: {
                        operator: "and",
                        filters: [{ field: "video_watch_time", operator: "eq", value: 95 }]
                    }
                }]
            }
        })
    });

    // Experiment 4: subtype VIDEO, event_sources: [{id: videoId, type: "video"}]
    // Rule: filter: { field: "event", operator: "eq", value: "video_watch_time" }, { field: "value", operator: "eq", value: "95_percent" }
    await test("Experiment 4: subtype VIDEO, event=video_watch_time + value=95_percent", {
        name: `Test Experiment 4 - ${Date.now()}`,
        subtype: "VIDEO",
        rule: JSON.stringify({
            inclusions: {
                operator: "or",
                rules: [{
                    event_sources: [{ id: videoId, type: "video" }],
                    retention_seconds: 31536000,
                    filter: {
                        operator: "and",
                        filters: [
                            { field: "event", operator: "eq", value: "video_watch_time" },
                            { field: "value", operator: "eq", value: "95_percent" }
                        ]
                    }
                }]
            }
        })
    });

    // Experiment 5: subtype ENGAGEMENT, event_sources: [{id: videoId, type: "video"}]
    // Rule: filter: { field: "event", operator: "eq", value: "video_watch_time" }, { field: "value", operator: "eq", value: "95_percent" }
    await test("Experiment 5: subtype ENGAGEMENT, event=video_watch_time + value=95_percent", {
        name: `Test Experiment 5 - ${Date.now()}`,
        subtype: "ENGAGEMENT",
        rule: JSON.stringify({
            inclusions: {
                operator: "or",
                rules: [{
                    event_sources: [{ id: videoId, type: "video" }],
                    retention_seconds: 31536000,
                    filter: {
                        operator: "and",
                        filters: [
                            { field: "event", operator: "eq", value: "video_watch_time" },
                            { field: "value", operator: "eq", value: "95_percent" }
                        ]
                    }
                }]
            }
        })
    });

    // Experiment 6: subtype VIDEO, event_sources: [{id: videoId, type: "video"}]
    // Rule: filter: { field: "video_watch_time_percentage", operator: "eq", value: 95 }
    await test("Experiment 6: subtype VIDEO, field: video_watch_time_percentage, value: 95", {
        name: `Test Experiment 6 - ${Date.now()}`,
        subtype: "VIDEO",
        rule: JSON.stringify({
            inclusions: {
                operator: "or",
                rules: [{
                    event_sources: [{ id: videoId, type: "video" }],
                    retention_seconds: 31536000,
                    filter: {
                        operator: "and",
                        filters: [{ field: "video_watch_time_percentage", operator: "eq", value: 95 }]
                    }
                }]
            }
        })
    });
}

run().catch(console.error);
