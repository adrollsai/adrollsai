import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function verifyContactsOnMeta() {
  const { data: p } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', 'pawan@pipixel.io')
    .single()

  const phoneId = p.whatsapp_phone_number_id
  const token = p.whatsapp_access_token

  console.log('Verifying Pawan phone 918528938292 on Meta Contacts API...')
  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/contacts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      blocking: 'wait',
      contacts: ['+918528938292', '+918288835235'],
      force_check: true
    })
  })

  const data = await res.json()
  console.log('Meta Contacts API result:', JSON.stringify(data, null, 2))
}

verifyContactsOnMeta().then(() => process.exit(0)).catch(console.error)
