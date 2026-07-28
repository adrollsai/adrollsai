import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function fixMessageOrdering() {
    console.log('--- FIXING CHRONOLOGICAL ORDERING FOR TEMPLATE MESSAGES ---');

    // 1. Fetch all chats
    const { data: chats } = await supabaseAdmin
        .from('whatsapp_chats')
        .select('id, created_at, updated_at');

    if (!chats) return;

    let fixedCount = 0;

    for (const chat of chats) {
        // Fetch messages for chat
        const { data: messages } = await supabaseAdmin
            .from('whatsapp_messages')
            .select('id, direction, message_text, created_at')
            .eq('chat_id', chat.id)
            .order('created_at', { ascending: true });

        if (!messages || messages.length <= 1) continue;

        // Find template message
        const templateMsg = messages.find(m => m.direction === 'outbound' && m.message_text.startsWith('Sent Template:'));
        if (!templateMsg) continue;

        // Find earliest message in chat (inbound or outbound reply)
        const nonTemplateMsgs = messages.filter(m => m.id !== templateMsg.id);
        if (nonTemplateMsgs.length === 0) continue;

        const earliestNonTemplate = nonTemplateMsgs[0];
        const earliestTime = new Date(earliestNonTemplate.created_at).getTime();
        const templateTime = new Date(templateMsg.created_at).getTime();

        // If template timestamp is AFTER the first lead reply, move template timestamp to 10 seconds BEFORE first lead reply!
        if (templateTime >= earliestTime) {
            const correctedTime = new Date(earliestTime - 10000).toISOString();
            console.log(`Fixing chat ${chat.id}: moving template msg timestamp from ${templateMsg.created_at} -> ${correctedTime} (10s before first reply ${earliestNonTemplate.created_at})`);

            await supabaseAdmin
                .from('whatsapp_messages')
                .update({ created_at: correctedTime })
                .eq('id', templateMsg.id);

            fixedCount++;
        }
    }

    console.log(`\n--- CHRONOLOGICAL FIX COMPLETE ---`);
    console.log(`Corrected timestamp order for ${fixedCount} chat conversations.`);
}

fixMessageOrdering().catch(console.error);
