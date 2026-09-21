import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkMsgDetails() {
  const { data: msg } = await supabase
    .from('whatsapp_messages')
    .select('*, whatsapp_chats(*)')
    .eq('id', '7305c77a-5846-4be9-9017-8875b633c94c')
    .single()

  console.log('Message details for test2:', msg)

  // Also check if there are any webhook logs or error logs in supabase
  // Let's list tables in supabase or check recent errors
}

checkMsgDetails().then(() => process.exit(0)).catch(console.error)
