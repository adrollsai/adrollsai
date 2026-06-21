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
    
    // Experiment 14: rule as array of event_name and object_id, subtype ENGAGEMENT
    await test("Experiment 14: rule as array of event_name + object_id, subtype ENGAGEMENT", {
        name: `Test Experiment 14 - ${Date.now()}`,
        subtype: "ENGAGEMENT",
        rule: JSON.stringify([
            {
                event_name: "video_view_15s",
                object_id: videoId
            }
        ])
    });

    // Experiment 15: rule as array of event_name + object_id, subtype VIDEO
    await test("Experiment 15: rule as array of event_name + object_id, subtype VIDEO", {
        name: `Test Experiment 15 - ${Date.now()}`,
        subtype: "VIDEO",
        rule: JSON.stringify([
            {
                event_name: "video_view_15s",
                object_id: videoId
            }
        ])
    });

    // Experiment 16: rule as array with video_completed (95%)
    await test("Experiment 16: event_name = video_completed (95%)", {
        name: `Test Experiment 16 - ${Date.now()}`,
        subtype: "ENGAGEMENT",
        rule: JSON.stringify([
            {
                event_name: "video_completed",
                object_id: videoId
            }
        ])
    });
}

run().catch(console.error);
