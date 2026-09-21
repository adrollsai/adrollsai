import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const PIPIXEL_USER_ID = 'c7bede84-d7ea-4b02-bbbb-017d24a37914'
const PAWAN_LEAD_ID = 'bab6aa86-6d5a-45a8-af2c-812f0ea44ce6'
const CORRECT_PHONE = '918528938292'

async function cleanPawanChats() {
  // 1. Update the chat with phone 918528938292 to link to Pawan lead
  const { data: updatedChat, error: err1 } = await supabase
    .from('whatsapp_chats')
    .update({
      recipient_name: 'Pawan',
      recipient_phone: CORRECT_PHONE,
      lead_id: PAWAN_LEAD_ID
    })
    .eq('id', '54c64a18-dfc4-490a-a390-1b3536891e01')
    .select()

  console.log('Linked chat to Pawan lead:', updatedChat, err1)

  // 2. Fix or delete the orphaned chat with +8528938292
  const { error: delErr } = await supabase
    .from('whatsapp_chats')
    .delete()
    .eq('id', '24be8340-16a7-4640-9542-406b6d80ce98')

  console.log('Deleted orphaned malformed chat (+8528938292):', delErr || 'Success')
}

cleanPawanChats().then(() => process.exit(0)).catch(console.error)
