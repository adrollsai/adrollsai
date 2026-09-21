import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkAccurateStats() {
  const bioqueUserId = '68b55a31-a16d-454d-a20f-11adabf590b0'

  const { data: chats } = await supabase
    .from('whatsapp_chats')
    .select('id')
    .eq('user_id', bioqueUserId)

  const chatIds = (chats || []).map(c => c.id)
  console.log(`Total chats for Bioque: ${chatIds.length}`)

  let allMsgs: any[] = []
  for (let i = 0; i < chatIds.length; i += 50) {
    const chunk = chatIds.slice(i, i + 50)
    const { data: mChunk } = await supabase
      .from('whatsapp_messages')
      .select('id, message_text, created_at')
      .in('chat_id', chunk)
      .eq('direction', 'outbound')
    if (mChunk) allMsgs = allMsgs.concat(mChunk)
  }

  console.log(`Total outbound messages across Bioque chats: ${allMsgs.length}`)

  let withDeliveryFailed = 0
  let cleanTemplate = 0
  for (const m of allMsgs) {
    if (m.message_text.includes('Delivery Failed by Meta')) {
      withDeliveryFailed++
    } else {
      cleanTemplate++
    }
  }

  console.log(`Outbound messages with 'Delivery Failed by Meta' appended: ${withDeliveryFailed}`)
  console.log(`Outbound messages clean / delivered: ${cleanTemplate}`)

  // Check task-1741 progress
  const broadcastId = '4ae10fb1-df0a-4c96-b284-1fb3be9efdeb'
  const { data: recs } = await supabase
    .from('whatsapp_broadcast_recipients')
    .select('status')
    .eq('broadcast_id', broadcastId)

  const counts = (recs || []).reduce((acc: any, r: any) => {
    acc[r.status] = (acc[r.status] || 0) + 1
    return acc
  }, {})
  console.log(`Broadcast 2 recipients status:`, counts)
}

checkAccurateStats().then(() => process.exit(0)).catch(console.error)
