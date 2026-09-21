import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function debugToken() {
  const { data: p } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', 'pawan@pipixel.io')
    .single()

  const token = p.whatsapp_access_token

  const res = await fetch(`https://graph.facebook.com/v20.0/debug_token?input_token=${token}&access_token=${token}`)
  const data = await res.json()
  console.log('Token debug info:', JSON.stringify(data, null, 2))

  // Also query /me/accounts or /me
  const meRes = await fetch(`https://graph.facebook.com/v20.0/me?fields=id,name,email`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  console.log('Me info:', await meRes.json())
}

debugToken().then(() => process.exit(0)).catch(console.error)
