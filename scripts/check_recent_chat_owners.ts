import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkChatOwners() {
  const chatIds = [
    'bc33a994-caf8-4061-99da-b6480edf6fc5',
    '2d7bc1c2-b34d-4549-95fb-67a0ab3bf164',
    '8fadf6db-7460-4976-b14b-60856a34001f',
    'eaa9df95-63c6-46f9-8067-3369fb21d078'
  ];

  const { data: chats } = await supabaseAdmin
    .from('whatsapp_chats')
    .select('id, user_id, recipient_phone, recipient_name, last_message_text, updated_at')
    .in('id', chatIds);

  console.log('Chats details for recent inbounds:');
  console.log(chats);

  // Also check if any chat in Bioque has any inbound messages at all
  const { data: bioqueChats } = await supabaseAdmin
    .from('whatsapp_chats')
    .select('id, recipient_phone, recipient_name')
    .eq('user_id', '68b55a31-a16d-454d-a20f-11adabf590b0');

  const bChatIds = (bioqueChats || []).map(c => c.id);
  const { data: bInbound } = await supabaseAdmin
    .from('whatsapp_messages')
    .select('id, chat_id, message_text, direction, created_at')
    .in('chat_id', bChatIds)
    .eq('direction', 'inbound');

  console.log('Bioque inbound messages count:', bInbound?.length || 0);
  if (bInbound && bInbound.length > 0) {
    console.log('Bioque inbound messages:', bInbound);
  }
}

checkChatOwners().then(() => process.exit(0)).catch(console.error);
