import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testDelivery() {
    const userId = '2f62a259-f23b-48ee-a920-c436f36eaa4b';

    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

    const accessToken = profile.whatsapp_access_token;
    const phoneId = profile.whatsapp_phone_number_id;
    const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`;

    console.log('Sending single test probe to check if Meta billing is clear...');
    const res = await fetch(metaUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: '918288835235',
            type: 'template',
            template: {
                name: 'anmol_avenu_wp_template',
                language: { code: 'en_US' },
                components: [
                    {
                        type: 'header',
                        parameters: [
                            {
                                type: 'image',
                                image: {
                                    link: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/templates/bc63c065-9bcc-4793-bedc-f0960406425b/webinar_thursday_official.png'
                                }
                            }
                        ]
                    }
                ]
            }
        })
    });

    const data = await res.json();
    console.log('Meta HTTP response:', data);

    const messageId = data.messages?.[0]?.id;
    if (!messageId) {
        console.log('No message ID returned from Meta.');
        return;
    }

    console.log(`Probe message sent! ID: ${messageId}. Waiting 8 seconds for Meta delivery webhook...`);
    await new Promise(r => setTimeout(r, 8000));

    // Check recent webhook entries
    const { data: recentHistory } = await supabaseAdmin
        .from('lead_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(3);

    console.log('Recent webhook events in lead_history:', recentHistory);
}

testDelivery().catch(console.error);
