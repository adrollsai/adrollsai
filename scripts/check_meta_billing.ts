import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkMetaBilling() {
    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', '2f62a259-f23b-48ee-a920-c436f36eaa4b')
        .single();

    const wabaId = profile.whatsapp_waba_id;
    const token = profile.whatsapp_access_token;
    const phoneId = profile.whatsapp_phone_number_id;

    console.log('Querying Meta Graph API for WABA:', wabaId);

    // 1. Query WABA fields
    const res = await fetch(`https://graph.facebook.com/v20.0/${wabaId}?fields=id,name,currency,primary_funding_id,account_review_status,ownership_type,payment_method`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('WABA details:', await res.json());

    // 2. Query Phone Number fields
    const phoneRes = await fetch(`https://graph.facebook.com/v20.0/${phoneId}?fields=id,display_phone_number,verified_name,code_verification_status,quality_rating,messaging_limit_tier,status`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('Phone details:', await phoneRes.json());

    // 3. Let's do a test send of `anmol_avenu_wp_template` to Raman (+918288835235) from Blue Square's phone ID
    console.log('\n--- ATTEMPTING TEST SEND TO 918288835235 ---');
    const testPayload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: "918288835235",
        type: "template",
        template: {
            name: "anmol_avenu_wp_template",
            language: { code: "en_US" },
            components: [
                {
                    type: "header",
                    parameters: [
                        {
                            type: "image",
                            image: {
                                link: "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/templates/bc63c065-9bcc-4793-bedc-f0960406425b/webinar_thursday_official.png"
                            }
                        }
                    ]
                }
            ]
        }
    };

    const sendRes = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(testPayload)
    });

    const sendData = await sendRes.json();
    console.log('Test send response status:', sendRes.status);
    console.log('Test send response data:', JSON.stringify(sendData, null, 2));
}

checkMetaBilling().catch(console.error);
