import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkFailedMessages() {
    const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
    
    // Find all chats for this user
    const { data: chats } = await supabaseAdmin
        .from('whatsapp_chats')
        .select('id, recipient_phone, recipient_name, updated_at')
        .eq('user_id', userId);

    console.log(`Total chats for rchopra: ${chats?.length}`);
    const chatIds = (chats || []).map(c => c.id);

    if (chatIds.length > 0) {
        // Fetch failed messages
        const { data: failedMsgs } = await supabaseAdmin
            .from('whatsapp_messages')
            .select('*')
            .in('chat_id', chatIds)
            .ilike('message_text', '%Delivery Failed%')
            .order('created_at', { ascending: false });

        console.log(`Failed messages count: ${failedMsgs?.length}`);
        console.log('Sample failed messages:');
        for (const m of (failedMsgs || []).slice(0, 15)) {
            console.log(`[${m.created_at}] Chat: ${m.chat_id} | Text:\n${m.message_text}\n---`);
        }
    }

    // Also check lead_history for delivery failed
    const { data: failedHistory } = await supabaseAdmin
        .from('lead_history')
        .select('*')
        .ilike('description', '%Delivery Failed%')
        .order('created_at', { ascending: false })
        .limit(20);

    console.log('\n--- LEAD HISTORY DELIVERY FAILURES ---');
    console.log(failedHistory);
}

checkFailedMessages().catch(console.error);
