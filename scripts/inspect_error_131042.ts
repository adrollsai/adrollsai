import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function inspectError131042() {
    const leadId = '53135c22-f3a2-4dc5-b3a0-99917a113d13';

    const { data: lead } = await supabaseAdmin.from('leads').select('*').eq('id', leadId).single();
    console.log('Lead:', lead);

    const { data: chat } = await supabaseAdmin.from('whatsapp_chats').select('*').eq('lead_id', leadId);
    console.log('Chat:', chat);

    if (chat && chat.length > 0) {
        const { data: msgs } = await supabaseAdmin.from('whatsapp_messages').select('*').eq('chat_id', chat[0].id).order('created_at', { ascending: true });
        console.log('Messages for this chat:', msgs);
    }
}

inspectError131042().catch(console.error);
