import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BCAST_ID = '424bf231-dff3-439a-8545-713a077a196f'

async function checkFailedBreakdown() {
  const { data: failed } = await supabase
    .from('whatsapp_broadcast_recipients')
    .select('phone_number, error_message')
    .eq('broadcast_id', BCAST_ID)
    .eq('status', 'failed')

  const counts: Record<string, number> = {}
  for (const f of failed || []) {
    const err = f.error_message || 'Unknown'
    counts[err] = (counts[err] || 0) + 1
  }

  console.log('Failed errors breakdown:', counts)
}

checkFailedBreakdown().then(() => process.exit(0)).catch(console.error)
