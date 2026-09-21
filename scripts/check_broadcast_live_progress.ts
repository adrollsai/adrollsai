import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BCAST_ID = '424bf231-dff3-439a-8545-713a077a196f'

async function checkProgress() {
  const { data: recs } = await supabase
    .from('whatsapp_broadcast_recipients')
    .select('status')
    .eq('broadcast_id', BCAST_ID)

  const total = recs?.length || 0
  const sent = recs?.filter(r => r.status === 'sent').length || 0
  const failed = recs?.filter(r => r.status === 'failed').length || 0
  const pending = recs?.filter(r => r.status === 'pending').length || 0

  console.log(`Broadcast Progress: Total=${total}, Sent=${sent}, Failed=${failed}, Pending=${pending}`)
}

checkProgress().then(() => process.exit(0)).catch(console.error)
