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
    // This is the Page/Post Video ID from the ad spec
    const pageVideoId = '2433116303834921'; 

    await test("Page Video ID: value = video_watched_95_percent", {
        name: `Test Experiment Page Video - ${Date.now()}`,
        subtype: "VIDEO",
        rule: JSON.stringify({
            inclusions: {
                operator: "or",
                rules: [{
                    event_sources: [{ id: pageVideoId, type: "video" }],
                    retention_seconds: 31536000,
                    filter: {
                        operator: "and",
                        filters: [{ field: "event", operator: "eq", value: "video_watched_95_percent" }]
                    }
                }]
            }
        })
    });

    await test("Page Video ID: value = video_completed", {
        name: `Test Experiment Page Video 2 - ${Date.now()}`,
        subtype: "VIDEO",
        rule: JSON.stringify({
            inclusions: {
                operator: "or",
                rules: [{
                    event_sources: [{ id: pageVideoId, type: "video" }],
                    retention_seconds: 31536000,
                    filter: {
                        operator: "and",
                        filters: [{ field: "event", operator: "eq", value: "video_completed" }]
                    }
                }]
            }
        })
    });
}

run().catch(console.error);
