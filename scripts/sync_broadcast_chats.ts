import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function syncBroadcastChats() {
    const broadcastId = 'ecd17a20-5f12-4a2d-902b-542492e1e9b0';
    console.log(`--- SYNCING WHATSAPP CHATS & MESSAGES FOR BROADCAST ${broadcastId} ---`);

    // Fetch broadcast
    const { data: broadcast } = await supabaseAdmin
        .from('whatsapp_broadcasts')
        .select('*')
        .eq('id', broadcastId)
        .single();

    if (!broadcast) return console.error('Broadcast not found');

    const userId = broadcast.user_id;

    // Fetch sent recipients
    const { data: recipients } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('*')
        .eq('broadcast_id', broadcastId)
        .eq('status', 'sent');

    if (!recipients || recipients.length === 0) {
        console.log('No sent recipients found to sync.');
        return;
    }

    console.log(`Found ${recipients.length} sent recipients. Syncing chats and messages...`);

    // Fetch leads
    const leadIds = recipients.map(r => r.lead_id).filter(Boolean);
    let leads: any[] = [];
    for (let i = 0; i < leadIds.length; i += 200) {
        const batch = leadIds.slice(i, i + 200);
        const { data: bLeads } = await supabaseAdmin.from('leads').select('*').in('id', batch);
        if (bLeads) leads = leads.concat(bLeads);
    }

    const templateName = broadcast.template_name || 'investment_inquiry';
    const summaryText = `Sent Template: ${templateName}`;

    let createdChatCount = 0;
    let updatedChatCount = 0;
    let createdMsgCount = 0;

    for (let i = 0; i < recipients.length; i++) {
        const r = recipients[i];
        const lead = (leads || []).find(l => l.id === r.lead_id);
        const cleanPhone = (r.phone_number || lead?.phone || '').replace(/\D/g, '');
        if (!cleanPhone) continue;

        const recipientName = lead?.name || 'Prospect';

        // Check if chat exists
        let { data: chat } = await supabaseAdmin
            .from('whatsapp_chats')
            .select('id')
            .eq('user_id', userId)
            .eq('recipient_phone', cleanPhone)
            .maybeSingle();

        if (!chat) {
            const { data: newChat } = await supabaseAdmin
                .from('whatsapp_chats')
                .insert({
                    user_id: userId,
                    recipient_phone: cleanPhone,
                    recipient_name: recipientName,
                    lead_id: lead?.id || null,
                    last_message_text: summaryText,
                    unread_count: 0,
                    flow_answers: {},
                    flow_completed: false,
                    updated_at: new Date().toISOString()
                })
                .select('id')
                .maybeSingle();

            chat = newChat;
            createdChatCount++;
        } else {
            await supabaseAdmin
                .from('whatsapp_chats')
                .update({
                    last_message_text: summaryText,
                    lead_id: lead?.id || null,
                    recipient_name: recipientName,
                    updated_at: new Date().toISOString()
                })
                .eq('id', chat.id);

            updatedChatCount++;
        }

        if (chat) {
            // Check if outbound message already logged
            const { data: existingMsg } = await supabaseAdmin
                .from('whatsapp_messages')
                .select('id')
                .eq('chat_id', chat.id)
                .eq('direction', 'outbound')
                .eq('message_text', summaryText)
                .maybeSingle();

            if (!existingMsg) {
                await supabaseAdmin
                    .from('whatsapp_messages')
                    .insert({
                        chat_id: chat.id,
                        direction: 'outbound',
                        message_text: summaryText,
                        created_at: new Date().toISOString()
                    });
                createdMsgCount++;
            }
        }
    }

    console.log('\n--- CHAT SYNC COMPLETE ---');
    console.log(`Chats Created: ${createdChatCount}`);
    console.log(`Chats Updated: ${updatedChatCount}`);
    console.log(`Outbound Messages Created: ${createdMsgCount}`);
}

syncBroadcastChats().catch(console.error);
