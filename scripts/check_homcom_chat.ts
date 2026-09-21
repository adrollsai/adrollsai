import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkHomcomChat() {
  const { data: chats } = await supabase
    .from('whatsapp_chats')
    .select('*, whatsapp_messages(*)')
    .eq('user_id', '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2')
    .or('recipient_phone.ilike.%8288835235%')

  console.log('Homcom chat with 8288835235:', JSON.stringify(chats, null, 2))
}

checkHomcomChat().then(() => process.exit(0)).catch(console.error)
