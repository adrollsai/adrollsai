const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function test(name, event_name) {
    console.log(`\n--- Testing: ${name} ---`);
    try {
        const { data: prof } = await supabase.from('profiles').select('facebook_token, ad_account_id').eq('id', '2b0312dc-c1fc-4798-ab1c-339939271229').single();
        const formId = '962583836485360';
        const res = await fetch(`https://graph.facebook.com/v19.0/${prof.ad_account_id}/customaudiences`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: `Test Lead Event ${event_name} - ${Date.now()}`,
                subtype: "ENGAGEMENT",
                rule: JSON.stringify([
                    {
                        event_name: event_name,
                        object_id: formId
                    }
                ]),
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
    const list = [
        "leadgen_opened",
        "leadgen_submitted",
        "leadgen_form_opened",
        "leadgen_form_submitted",
        "lead_form_opened",
        "lead_form_submitted",
        "form_opened",
        "form_submitted"
    ];

    for (const event of list) {
        await test(event, event);
    }
}

run().catch(console.error);
