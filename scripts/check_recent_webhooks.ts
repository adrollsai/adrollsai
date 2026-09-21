import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkRecentWebhookMessages() {
  // Let's check processed_webhook_messages or any recent webhook entries
  const { data: recents } = await supabase
    .from('processed_webhook_messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20)

  console.log('Recent processed webhook message IDs:', recents)

  // Also check if there are any broadcast recipients or lead history for Pawan (8528938292)
  const { data: lh } = await supabase
    .from('lead_history')
    .select('*')
    .ilike('description', '%8528938292%')
  console.log('Lead history for Pawan:', lh)
}

checkRecentWebhookMessages().then(() => process.exit(0)).catch(console.error)
