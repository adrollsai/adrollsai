import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function completeBroadcastSend() {
    const broadcastId = 'ecd17a20-5f12-4a2d-902b-542492e1e9b0';
    console.log(`--- COMPLETING BROADCAST SEND FOR ${broadcastId} ---`);

    const { data: broadcast } = await supabaseAdmin
        .from('whatsapp_broadcasts')
        .select('*')
        .eq('id', broadcastId)
        .single();

    if (!broadcast) return console.error('Broadcast not found');

    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', broadcast.user_id)
        .single();

    if (!profile) return console.error('Profile not found');

    // Fetch recipients with status 'failed'
    const { data: recipients } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('*')
        .eq('broadcast_id', broadcastId)
        .eq('status', 'failed');

    if (!recipients || recipients.length === 0) return console.log('No failed recipients to process');

    console.log(`Processing remaining ${recipients.length} failed recipients...`);

    // Fetch leads in batches of 100
    const leadIds = recipients.map(r => r.lead_id).filter(Boolean);
    let leads: any[] = [];
    for (let i = 0; i < leadIds.length; i += 100) {
        const batch = leadIds.slice(i, i + 100);
        const { data: bLeads } = await supabaseAdmin.from('leads').select('*').in('id', batch);
        if (bLeads) leads = leads.concat(bLeads);
    }

    const accessToken = profile.whatsapp_access_token;
    const phoneId = profile.whatsapp_phone_number_id;
    const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`;

    // Template details
    const templateLanguageCode = 'en_US';

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < recipients.length; i++) {
        const r = recipients[i];
        const lead = (leads || []).find(l => l.id === r.lead_id);

        let cleanPhone = (r.phone_number || lead?.phone || '').replace(/\D/g, '');
        if (!cleanPhone) continue;
        if (cleanPhone.length === 10) {
            cleanPhone = '91' + cleanPhone;
        }

        const recipientName = lead?.name || 'Valued Customer';
        const parameters = [
            { type: 'text', text: recipientName }
        ];

        const templatePayload: any = {
            name: broadcast.template_name,
            language: { code: templateLanguageCode },
            components: [
                {
                    type: 'body',
                    parameters
                }
            ]
        };

        const messagePayload = {
            messaging_product: 'whatsapp',
            to: cleanPhone,
            type: 'template',
            template: templatePayload
        };

        try {
            const metaRes = await fetch(metaUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(messagePayload)
            });

            const metaData = await metaRes.json();

            if (metaData.error) {
                failCount++;
                console.error(`[${i+1}/${recipients.length}] Failed to ${cleanPhone}:`, metaData.error.message);
                await supabaseAdmin
                    .from('whatsapp_broadcast_recipients')
                    .update({ status: 'failed', error_message: metaData.error.message || 'Meta API returned error' })
                    .eq('id', r.id);
            } else {
                successCount++;
                const sentAtTime = new Date().toISOString();
                console.log(`[${i+1}/${recipients.length}] Sent to ${cleanPhone}! Msg ID: ${metaData.messages?.[0]?.id}`);
                await supabaseAdmin
                    .from('whatsapp_broadcast_recipients')
                    .update({ status: 'sent', sent_at: sentAtTime, error_message: null })
                    .eq('id', r.id);

                // Create or update whatsapp_chats and whatsapp_messages
                const summaryText = `Sent Template: ${broadcast.template_name}`;
                let { data: chat } = await supabaseAdmin
                    .from('whatsapp_chats')
                    .select('id')
                    .eq('user_id', broadcast.user_id)
                    .eq('recipient_phone', cleanPhone)
                    .maybeSingle();

                if (!chat) {
                    const { data: newChat } = await supabaseAdmin
                        .from('whatsapp_chats')
                        .insert({
                            user_id: broadcast.user_id,
                            recipient_phone: cleanPhone,
                            recipient_name: recipientName,
                            lead_id: lead?.id || null,
                            last_message_text: summaryText,
                            unread_count: 0,
                            flow_answers: {},
                            flow_completed: false,
                            updated_at: sentAtTime
                        })
                        .select('id')
                        .maybeSingle();
                    chat = newChat;
                }

                if (chat) {
                    await supabaseAdmin
                        .from('whatsapp_messages')
                        .insert({
                            chat_id: chat.id,
                            direction: 'outbound',
                            message_text: summaryText,
                            created_at: sentAtTime
                        });
                }
            }
        } catch (err: any) {
            failCount++;
            console.error(`[${i+1}/${recipients.length}] Error sending to ${cleanPhone}:`, err.message);
        }

        // Throttle 40ms (~25 msg/sec)
        await new Promise(resolve => setTimeout(resolve, 40));
    }

    console.log(`\n--- SEND COMPLETE ---`);
    console.log(`Successfully Sent: ${successCount}`);
    console.log(`Failed: ${failCount}`);

    await supabaseAdmin
        .from('whatsapp_broadcasts')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', broadcastId);
}

completeBroadcastSend().catch(console.error);
