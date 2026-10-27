import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function sendUmangTemplate() {
    const userId = 'b685d287-7d54-4c9c-ae03-a46bb96ebdde'; // Umang Associates
    const recipient = '+919599025069';

    const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

    if (error || !profile) {
        console.error('Failed to get Umang profile:', error);
        return;
    }

    const whatsappToken = profile.whatsapp_access_token || profile.facebook_token;
    const whatsappPhoneId = profile.whatsapp_phone_number_id;

    console.log('Sending WhatsApp template message for:');
    console.log('Sender Name:', profile.business_name);
    console.log('Sender Phone ID:', whatsappPhoneId);
    console.log('Sender Display Number:', profile.whatsapp_phone_number);
    console.log('Recipient:', recipient);

    // Clean recipient phone
    let cleanRecipient = recipient.replace(/\D/g, '');
    if (cleanRecipient.startsWith('00')) cleanRecipient = cleanRecipient.substring(2);
    if (cleanRecipient.length === 10) cleanRecipient = '91' + cleanRecipient;
    else if (cleanRecipient.length === 11 && cleanRecipient.startsWith('0')) cleanRecipient = '91' + cleanRecipient.substring(1);

    // Using approved template 'real_estate_tailored_inventory'
    const templateName = 'real_estate_tailored_inventory';
    const languageCode = 'en_US';

    const messagePayload = {
        messaging_product: 'whatsapp',
        to: cleanRecipient,
        type: 'template',
        template: {
            name: templateName,
            language: {
                code: languageCode
            }
        }
    };

    console.log('\nPayload:', JSON.stringify(messagePayload, null, 2));

    const metaUrl = `https://graph.facebook.com/v20.0/${whatsappPhoneId}/messages`;
    const metaRes = await fetch(metaUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${whatsappToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(messagePayload)
    });

    const metaData = await metaRes.json();
    console.log('\nHTTP Status:', metaRes.status);
    console.log('Meta Response:', JSON.stringify(metaData, null, 2));

    if (!metaRes.ok || metaData.error) {
        console.error('❌ Failed to send template:', metaData.error);
        return;
    }

    const messageId = metaData.messages?.[0]?.id;
    const messageStatus = metaData.messages?.[0]?.message_status;
    console.log(`\n✅ Template message successfully sent! Message ID: ${messageId}, Status: ${messageStatus || 'accepted'}`);

    // Record in whatsapp_chats and whatsapp_messages
    try {
        const rawPhoneDigits = cleanRecipient;
        const nowIso = new Date().toISOString();

        let { data: existingChat } = await supabase
            .from('whatsapp_chats')
            .select('id')
            .eq('user_id', userId)
            .eq('recipient_phone', rawPhoneDigits)
            .maybeSingle();

        if (!existingChat) {
            const { data: newChat } = await supabase
                .from('whatsapp_chats')
                .insert({
                    user_id: userId,
                    recipient_phone: rawPhoneDigits,
                    recipient_name: '+' + rawPhoneDigits,
                    unread_count: 0,
                    last_message_text: `Sent Template: ${templateName}`,
                    updated_at: nowIso
                })
                .select('id')
                .single();
            existingChat = newChat;
        } else {
            await supabase
                .from('whatsapp_chats')
                .update({
                    last_message_text: `Sent Template: ${templateName}`,
                    updated_at: nowIso
                })
                .eq('id', existingChat.id);
        }

        if (existingChat?.id) {
            await supabase.from('whatsapp_messages').insert({
                chat_id: existingChat.id,
                direction: 'outbound',
                message_text: `[Template: ${templateName}] Hi! 👋 Please answer a few quick questions so we can instantly send you a curated inventory list & brochure matched to your preferences: 🎁🏢`,
                created_at: nowIso
            });
            console.log('✅ Chat & message record logged to CRM database.');
        }
    } catch (dbErr) {
        console.warn('DB recording warning:', dbErr);
    }
}

sendUmangTemplate().catch(console.error);
