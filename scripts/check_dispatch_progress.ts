import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function check() {
  const broadcastId = '4ae10fb1-df0a-4c96-b284-1fb3be9efdeb'
  const { data: recs } = await supabase
    .from('whatsapp_broadcast_recipients')
    .select('status')
    .eq('broadcast_id', broadcastId)

  const counts = (recs || []).reduce((acc: any, r: any) => {
    acc[r.status] = (acc[r.status] || 0) + 1
    return acc
  }, {})

  console.log('Current broadcast progress:', counts)

  const bioqueUserId = '68b55a31-a16d-454d-a20f-11adabf590b0'
  const { data: chats } = await supabase
    .from('whatsapp_chats')
    .select('id, recipient_name, recipient_phone, last_message_text, updated_at')
    .eq('user_id', bioqueUserId)

  const chatIds = (chats || []).map(c => c.id)
  const { data: inbounds } = await supabase
    .from('whatsapp_messages')
    .select('id, chat_id, message_text, created_at')
    .in('chat_id', chatIds)
    .eq('direction', 'inbound')
    .gt('created_at', '2026-09-20T04:00:00Z')
    .order('created_at', { ascending: false })

  console.log('\nInbound messages today:', inbounds?.length || 0)
  for (const m of inbounds || []) {
    const ch = (chats || []).find(c => c.id === m.chat_id)
    console.log(`- ${ch?.recipient_name || 'Unknown'} (${ch?.recipient_phone}): "${m.message_text}" at ${m.created_at}`)
  }
}

check().then(() => process.exit(0)).catch(console.error)
