import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function testPawanSend() {
  const { data: p } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', 'pawan@pipixel.io')
    .single()

  console.log('Testing send from PiPixel to Pawan (918528938292) with template "test2"...')
  const phoneId = p.whatsapp_phone_number_id
  const token = p.whatsapp_access_token

  // Try sending test2 to Pawan
  const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`
  const payload = {
    messaging_product: 'whatsapp',
    to: '918528938292',
    type: 'template',
    template: {
      name: 'test2',
      language: { code: 'en_US' }
    }
  }

  const res = await fetch(metaUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  const resData = await res.json()
  console.log('PiPixel to Pawan response:', JSON.stringify(resData, null, 2))
}

testPawanSend().then(() => process.exit(0)).catch(console.error)
