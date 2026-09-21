import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkLatestDelivery() {
  // Check broadcast recipient status
  const { data: rec } = await supabase
    .from('whatsapp_broadcast_recipients')
    .select('*')
    .ilike('phone_number', '%8288835235%')
    .order('sent_at', { ascending: false })
    .limit(2)

  console.log('Latest recipient records for 8288835235:', rec)
}

checkLatestDelivery().then(() => process.exit(0)).catch(console.error)
