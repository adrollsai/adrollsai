import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function sendToFailedNumber() {
    const userId = '2f62a259-f23b-48ee-a920-c436f36eaa4b';
    const recipientId = 'cf9e1b59-e1c5-40ab-9b45-ba1ee345befe';
    const phone = '919728958196';

    const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
    if (!profile) return console.log('Profile not found');

    const accessToken = profile.whatsapp_access_token;
    const phoneId = profile.whatsapp_phone_number_id;
    const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`;

    // Clean name by removing invisible unicode spaces and special characters
    const rawName = 'ㅤ                                         ㅤ The__SilëńT___Eyeš';
    const cleanedName = rawName.replace(/[\u3164\u200B-\u200D\uFEFF]/g, '').trim() || 'Valued Customer';
    console.log(`Raw Name: "${rawName}"`);
    console.log(`Cleaned Name for Meta: "${cleanedName}"`);

    const messagePayload = {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
            name: 'investment_inquiry',
            language: { code: 'en_US' },
            components: [
                {
                    type: 'body',
                    parameters: [
                        { type: 'text', text: cleanedName }
                    ]
                }
            ]
        }
    };

    console.log('Sending message to Meta...');
    const res = await fetch(metaUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(messagePayload)
    });

    const data = await res.json();
    console.log('Meta API Response:', data);

    if (data.messages?.[0]?.id) {
        console.log('SUCCESS! Message delivered to 919728958196!');
        await supabaseAdmin
            .from('whatsapp_broadcast_recipients')
            .update({ status: 'sent', sent_at: new Date().toISOString(), error_message: null })
            .eq('id', recipientId);
    }
}

sendToFailedNumber().catch(console.error);
