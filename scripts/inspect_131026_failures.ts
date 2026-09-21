import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function inspectFailures() {
  const bioqueUserId = '68b55a31-a16d-454d-a20f-11adabf590b0'

  // Check the message for Rasik Liladhar Dudwadkar
  const { data: rasikLead } = await supabase
    .from('leads')
    .select('id, name, phone')
    .ilike('phone', '%9820990022%')
    .maybeSingle()

  console.log('Rasik Lead:', rasikLead)

  // Check recent lead_history for delivery failures
  const { data: history } = await supabase
    .from('lead_history')
    .select('*')
    .ilike('description', '%Delivery Failed%')
    .order('created_at', { ascending: false })
    .limit(20)

  console.log('\nRecent Delivery Failure Events in lead_history:', history?.length || 0)
  for (const h of history || []) {
    console.log(`- Lead ${h.lead_id}: ${h.description} at ${h.created_at}`)
  }

  // Check broadcast recipients status
  const broadcastId = '4ae10fb1-df0a-4c96-b284-1fb3be9efdeb'
  const { data: recs } = await supabase
    .from('whatsapp_broadcast_recipients')
    .select('status, error_message')
    .eq('broadcast_id', broadcastId)

  const counts = (recs || []).reduce((acc: any, r: any) => {
    acc[r.status] = (acc[r.status] || 0) + 1
    return acc
  }, {})
  console.log('\nBroadcast 2 recipient statuses:', counts)

  const errors = (recs || []).filter(r => r.status === 'failed')
  console.log('Broadcast 2 failed count:', errors.length)
  if (errors.length > 0) {
    console.log('Sample failure reasons:', errors.slice(0, 5))
  }

  // Check how many messages in whatsapp_messages have "Delivery Failed"
  const { data: chats } = await supabase
    .from('whatsapp_chats')
    .select('id, recipient_phone, recipient_name')
    .eq('user_id', bioqueUserId)

  const chatIds = (chats || []).map(c => c.id)
  const { data: failedMsgs } = await supabase
    .from('whatsapp_messages')
    .select('id, chat_id, message_text, created_at')
    .in('chat_id', chatIds)
    .ilike('message_text', '%Delivery Failed%')
    .order('created_at', { ascending: false })

  console.log('\nTotal messages annotated with "Delivery Failed" in Bioque:', failedMsgs?.length || 0)
  for (const fm of (failedMsgs || []).slice(0, 10)) {
    const ch = (chats || []).find(c => c.id === fm.chat_id)
    console.log(`- ${ch?.recipient_name} (${ch?.recipient_phone}): ${fm.message_text.slice(-80)}`)
  }
}

inspectFailures().then(() => process.exit(0)).catch(console.error)
