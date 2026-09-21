import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkPawanDelivery() {
  const { data: recs } = await supabase
    .from('whatsapp_broadcast_recipients')
    .select('*')
    .ilike('phone_number', '%8528938292%')

  console.log('Pawan broadcast recipient records:', recs)

  // Also check if any chat exists for Pawan in PiPixel
  const { data: chat } = await supabase
    .from('whatsapp_chats')
    .select('*, whatsapp_messages(*)')
    .eq('user_id', 'c7bede84-d7ea-4b02-bbbb-017d24a37914')
    .ilike('recipient_phone', '%8528938292%')

  console.log('Pawan chat & messages in PiPixel:', JSON.stringify(chat, null, 2))
}

checkPawanDelivery().then(() => process.exit(0)).catch(console.error)
