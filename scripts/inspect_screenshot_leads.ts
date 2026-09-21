import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function inspectScreenshotLeads() {
  const names = ['Rasik', 'Jagjit', 'Kedar', 'pradeepkumar', 'Arvind', 'Naveen']

  for (const name of names) {
    const { data: chat } = await supabase
      .from('whatsapp_chats')
      .select('id, recipient_name, recipient_phone, last_message_text, updated_at')
      .ilike('recipient_name', `%${name}%`)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (chat) {
      const { data: msgs } = await supabase
        .from('whatsapp_messages')
        .select('id, message_text, created_at')
        .eq('chat_id', chat.id)
        .order('created_at', { ascending: false })
        .limit(2)

      console.log(`Lead: ${chat.recipient_name} (${chat.recipient_phone})`)
      console.log(`Chat last message text: ${chat.last_message_text}`)
      console.log(`Messages:`, msgs)
      console.log('---')
    }
  }
}

inspectScreenshotLeads().then(() => process.exit(0)).catch(console.error)
