import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkAllDeliveries() {
  const bioqueUserId = '68b55a31-a16d-454d-a20f-11adabf590b0'

  // Fetch all lead_history events for Bioque today
  const { data: historyEvents } = await supabase
    .from('lead_history')
    .select('action_type, description, created_at')
    .ilike('description', '%Delivery Failed%')
    .gt('created_at', '2026-09-20T04:00:00Z')

  console.log(`Total Delivery Failed events in lead_history today: ${historyEvents?.length || 0}`)

  const errorBreakdown = (historyEvents || []).reduce((acc: any, h: any) => {
    const codeMatch = h.description.match(/Error\s+(\d+)/)
    const code = codeMatch ? codeMatch[1] : 'other'
    acc[code] = (acc[code] || 0) + 1
    return acc
  }, {})
  console.log('Error code breakdown:', errorBreakdown)

  // Check how many messages are in whatsapp_messages for Bioque
  const { data: chats } = await supabase
    .from('whatsapp_chats')
    .select('id, recipient_phone, recipient_name')
    .eq('user_id', bioqueUserId)

  const chatIds = (chats || []).map(c => c.id)

  const { data: msgs } = await supabase
    .from('whatsapp_messages')
    .select('id, message_text')
    .in('chat_id', chatIds)
    .eq('direction', 'outbound')
    .gt('created_at', '2026-09-20T04:00:00Z')

  let totalOutbound = msgs?.length || 0
  let failedOutbound = 0
  let successOutbound = 0

  for (const m of msgs || []) {
    if (m.message_text.includes('Delivery Failed')) {
      failedOutbound++
    } else {
      successOutbound++
    }
  }

  console.log(`Total Outbound messages logged today: ${totalOutbound}`)
  console.log(`Success / Delivered / In-transit: ${successOutbound}`)
  console.log(`Annotated as Delivery Failed by Meta webhook: ${failedOutbound}`)

  // Check Broadcast 1 vs Broadcast 2 progress
  const { data: broadcasts } = await supabase
    .from('whatsapp_broadcasts')
    .select('id, title, status, created_at')
    .eq('user_id', bioqueUserId)
    .order('created_at', { ascending: false })
    .limit(3)

  console.log('\nBroadcasts:', broadcasts)

  for (const b of broadcasts || []) {
    const { data: recs } = await supabase
      .from('whatsapp_broadcast_recipients')
      .select('status')
      .eq('broadcast_id', b.id)

    const recCounts = (recs || []).reduce((acc: any, r: any) => {
      acc[r.status] = (acc[r.status] || 0) + 1
      return acc
    }, {})
    console.log(`Broadcast "${b.title}" recipient statuses:`, recCounts)
  }
}

checkAllDeliveries().then(() => process.exit(0)).catch(console.error)
