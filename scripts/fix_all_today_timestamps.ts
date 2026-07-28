import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function fixAllTodayTimestamps() {
    const broadcastId = 'ecd17a20-5f12-4a2d-902b-542492e1e9b0';
    console.log(`--- UPDATING ALL RECIPIENTS FOR BROADCAST ${broadcastId} TO TODAY (JULY 28) ---`);

    const { data: recipients } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('*')
        .eq('broadcast_id', broadcastId)
        .eq('status', 'sent');

    if (!recipients) return console.log('No recipients found');

    const { data: broadcast } = await supabaseAdmin
        .from('whatsapp_broadcasts')
        .select('user_id, template_name')
        .eq('id', broadcastId)
        .single();

    if (!broadcast) return;

    const templateName = broadcast.template_name || 'investment_inquiry';
    const summaryText = `Sent Template: ${templateName}`;

    let updatedCount = 0;

    for (const r of recipients) {
        let cleanPhone = r.phone_number.replace(/\D/g, '');
        if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

        const { data: chat } = await supabaseAdmin
            .from('whatsapp_chats')
            .select('id')
            .eq('user_id', broadcast.user_id)
            .eq('recipient_phone', cleanPhone)
            .maybeSingle();

        if (chat) {
            const actualSentAt = r.sent_at || '2026-07-28T11:37:00.000Z';

            // Find all outbound template messages in this chat
            const { data: msgs } = await supabaseAdmin
                .from('whatsapp_messages')
                .select('id')
                .eq('chat_id', chat.id)
                .eq('direction', 'outbound')
                .eq('message_text', summaryText);

            if (msgs && msgs.length > 0) {
                for (const m of msgs) {
                    await supabaseAdmin
                        .from('whatsapp_messages')
                        .update({ created_at: actualSentAt })
                        .eq('id', m.id);
                    updatedCount++;
                }
            }
        }
    }

    console.log(`\n--- ALL BROADCAST MESSAGES RESTORED TO TODAY (JULY 28) ---`);
    console.log(`Updated ${updatedCount} messages.`);
}

fixAllTodayTimestamps().catch(console.error);
