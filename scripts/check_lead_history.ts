import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkRecentLeadHistory() {
  const { data: history } = await supabase
    .from('lead_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10)

  console.log('Recent lead history entries:', history)
}

checkRecentLeadHistory().then(() => process.exit(0)).catch(console.error)
