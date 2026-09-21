import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkPawan() {
  const { data: bcastRecs } = await supabase
    .from('whatsapp_broadcast_recipients')
    .select('*')
    .or('phone_number.ilike.%8528938292%')
  console.log('Broadcast recipients for Pawan (8528938292):', bcastRecs)

  const { data: msgs } = await supabase
    .from('whatsapp_messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10)
  console.log('Recent whatsapp_messages:', msgs?.map(m => ({ id: m.id, direction: m.direction, text: m.message_text, created_at: m.created_at })))
}

checkPawan().then(() => process.exit(0)).catch(console.error)
