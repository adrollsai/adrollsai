import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkBroadcastReplies() {
    const broadcastId = 'ecd17a20-5f12-4a2d-902b-542492e1e9b0';
    console.log(`--- CHECKING BROADCAST REPLIES FOR ${broadcastId} ---`);

    const { data: broadcast } = await supabaseAdmin
        .from('whatsapp_broadcasts')
        .select('*')
        .eq('id', broadcastId)
        .single();

    if (!broadcast) return console.log('Broadcast not found');

    const { data: recipients } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('phone_number, lead_id, sent_at')
        .eq('broadcast_id', broadcastId)
        .eq('status', 'sent');

    if (!recipients) return console.log('No sent recipients');

    const recipientPhones = recipients.map(r => r.phone_number.replace(/\D/g, '')).filter(Boolean);

    // Fetch chats for these phones
    let chats: any[] = [];
    for (let i = 0; i < recipientPhones.length; i += 100) {
        const batch = recipientPhones.slice(i, i + 100);
        const { data: bChats } = await supabaseAdmin
            .from('whatsapp_chats')
            .select('id, recipient_phone, recipient_name')
            .eq('user_id', broadcast.user_id)
            .in('recipient_phone', batch);
        if (bChats) chats = chats.concat(bChats);
    }

    const chatIds = chats.map(c => c.id);
    console.log(`Found ${chats.length} chats for broadcast recipients.`);

    // Fetch inbound messages for these chat IDs
    let inboundMsgs: any[] = [];
    for (let i = 0; i < chatIds.length; i += 100) {
        const batch = chatIds.slice(i, i + 100);
        const { data: bMsgs } = await supabaseAdmin
            .from('whatsapp_messages')
            .select('chat_id, message_text, created_at')
            .in('chat_id', batch)
            .eq('direction', 'inbound')
            .order('created_at', { ascending: false });
        if (bMsgs) inboundMsgs = inboundMsgs.concat(bMsgs);
    }

    console.log(`Found ${inboundMsgs.length} total inbound messages across all recipient chats.`);

    // Map latest inbound message by chat_id
    const latestInboundMap = new Map();
    for (const msg of inboundMsgs) {
        if (!latestInboundMap.has(msg.chat_id)) {
            latestInboundMap.set(msg.chat_id, msg);
        }
    }

    let totalReplied = 0;
    const sampleReplies: any[] = [];

    for (const chat of chats) {
        const latestInbound = latestInboundMap.get(chat.id);
        if (latestInbound) {
            totalReplied++;
            if (sampleReplies.length < 10) {
                sampleReplies.push({
                    name: chat.recipient_name,
                    phone: chat.recipient_phone,
                    leadResponse: latestInbound.message_text,
                    time: latestInbound.created_at
                });
            }
        }
    }

    console.log(`\n--- REPLIES CALCULATION RESULTS ---`);
    console.log(`Total Recipients Who Sent Inbound Replies: ${totalReplied} / ${recipients.length}`);
    console.log('Sample Lead Inbound Responses:', sampleReplies);
}

checkBroadcastReplies().catch(console.error);
