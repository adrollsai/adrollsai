import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function cleanFailedAnnotations() {
  const bioqueUserId = '68b55a31-a16d-454d-a20f-11adabf590b0'

  const { data: chats } = await supabase
    .from('whatsapp_chats')
    .select('id')
    .eq('user_id', bioqueUserId)

  const chatIds = (chats || []).map(c => c.id)

  let updatedCount = 0
  for (let i = 0; i < chatIds.length; i += 50) {
    const chunk = chatIds.slice(i, i + 50)
    const { data: msgs } = await supabase
      .from('whatsapp_messages')
      .select('id, message_text')
      .in('chat_id', chunk)
      .ilike('message_text', '%Delivery Failed by Meta%')

    for (const m of msgs || []) {
      // Strip out the \n\n⚠️ *Delivery Failed by Meta...* part
      const cleanText = m.message_text.replace(/\n\n⚠️\s*\*?Delivery Failed by Meta[^\n]*/gi, '').trim()
      await supabase
        .from('whatsapp_messages')
        .update({ message_text: cleanText || 'Sent Template: sakhsi' })
        .eq('id', m.id)
      updatedCount++
    }
  }

  console.log(`Successfully cleaned up ${updatedCount} messages in Bioque chats!`)
}

cleanFailedAnnotations().then(() => process.exit(0)).catch(console.error)
