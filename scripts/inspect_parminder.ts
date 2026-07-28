import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function inspectParminder() {
    const phone = '919915110612';
    console.log(`--- INSPECTING CHAT FOR ${phone} ---`);

    const { data: chat } = await supabaseAdmin
        .from('whatsapp_chats')
        .select('*')
        .eq('recipient_phone', phone)
        .maybeSingle();

    console.log('Chat record:', chat);

    if (chat) {
        const { data: messages } = await supabaseAdmin
            .from('whatsapp_messages')
            .select('*')
            .eq('chat_id', chat.id)
            .order('created_at', { ascending: true });

        console.log('\n--- MESSAGES IN CHAT ---');
        console.log(messages);
    }

    const { data: recipient } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('*')
        .eq('phone_number', '+91 9915110612')
        .maybeSingle();

    console.log('\n--- BROADCAST RECIPIENT RECORD ---');
    console.log(recipient);
}

inspectParminder().catch(console.error);
