import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkResponses() {
  const bioqueUserId = '68b55a31-a16d-454d-a20f-11adabf590b0';
  const broadcastId = 'ea8742ad-1ce1-42ed-ac28-662839b684ba';

  console.log('=== 1. Checking Broadcast Recipients Status ===');
  const { data: recipients, error: rErr } = await supabaseAdmin
    .from('whatsapp_broadcast_recipients')
    .select('id, lead_id, phone_number, status, error_message, created_at')
    .eq('broadcast_id', broadcastId);

  if (rErr) console.error('Recipients error:', rErr);
  const statusCounts = (recipients || []).reduce((acc: any, r: any) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  console.log('Total recipients:', recipients?.length || 0);
  console.log('Recipients status breakdown:', statusCounts);

  const clickedRecipients = (recipients || []).filter((r: any) => r.status === 'clicked');
  console.log('Clicked recipients count:', clickedRecipients.length);
  if (clickedRecipients.length > 0) {
    console.log('Clicked details:', clickedRecipients);
  }

  console.log('\n=== 2. Checking WhatsApp Chats for Bioque ===');
  const { data: chats, error: cErr } = await supabaseAdmin
    .from('whatsapp_chats')
    .select('id, recipient_phone, recipient_name, last_message_text, unread_count, updated_at, flow_answers, flow_completed')
    .eq('user_id', bioqueUserId)
    .order('updated_at', { ascending: false });

  if (cErr) console.error('Chats query error:', cErr);
  console.log(`Total chats for Bioque: ${chats?.length || 0}`);

  const unreadChats = (chats || []).filter(c => (c.unread_count && c.unread_count > 0));
  console.log('Chats with unread count > 0:', unreadChats.length);
  if (unreadChats.length > 0) {
    console.log('Unread chats:', unreadChats);
  }

  console.log('\n=== 3. Checking WhatsApp Messages for Bioque Chats ===');
  const chatIds = (chats || []).map(c => c.id);
  if (chatIds.length > 0) {
    const { data: inboundMessages, error: mErr } = await supabaseAdmin
      .from('whatsapp_messages')
      .select('id, chat_id, message_text, direction, media_url, created_at, status')
      .in('chat_id', chatIds)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false });

    if (mErr) console.error('Inbound messages error:', mErr);
    console.log('Total inbound messages received:', inboundMessages?.length || 0);
    if (inboundMessages && inboundMessages.length > 0) {
      console.log('Inbound messages:', JSON.stringify(inboundMessages, null, 2));
    }

    // Check message statuses for outbound
    const { data: outboundMessages } = await supabaseAdmin
      .from('whatsapp_messages')
      .select('status, created_at')
      .in('chat_id', chatIds)
      .eq('direction', 'outbound')
      .order('created_at', { ascending: false })
      .limit(100);

    const outboundStatusMap = (outboundMessages || []).reduce((acc: any, m: any) => {
      acc[m.status || 'unknown'] = (acc[m.status || 'unknown'] || 0) + 1;
      return acc;
    }, {});
    console.log('Outbound message statuses (read/delivered/sent):', outboundStatusMap);
    if (outboundMessages && outboundMessages.length > 0) {
      console.log('First outbound message created_at:', outboundMessages[outboundMessages.length - 1]?.created_at);
      console.log('Latest outbound message created_at:', outboundMessages[0]?.created_at);
    }
  }

  console.log('\n=== 4. Checking Global Inbound Messages across all chats in DB ===');
  const { data: globalInbounds } = await supabaseAdmin
    .from('whatsapp_messages')
    .select('id, chat_id, message_text, direction, created_at')
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('Recent global inbounds across all accounts:');
  console.log(globalInbounds);
}

checkResponses().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
