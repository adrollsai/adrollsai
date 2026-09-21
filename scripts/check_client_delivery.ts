import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkClientDelivery() {
  const { data: rec } = await supabase
    .from('whatsapp_broadcast_recipients')
    .select('*')
    .ilike('phone_number', '%9779278117%')
    .order('sent_at', { ascending: false })
    .limit(1)

  console.log('Recipient status for 9779278117:', rec)
}

checkClientDelivery().then(() => process.exit(0)).catch(console.error)
