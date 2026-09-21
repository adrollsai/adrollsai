import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

async function checkDevTokenTemplates() {
  const devToken = process.env.DEV_WHATSAPP_ACCESS_TOKEN
  const pipixelWaba = '1446302204023665'

  console.log('Using DEV_WHATSAPP_ACCESS_TOKEN to query PiPixel WABA', pipixelWaba)
  const res = await fetch(`https://graph.facebook.com/v20.0/${pipixelWaba}/message_templates?limit=50`, {
    headers: { 'Authorization': `Bearer ${devToken}` }
  })
  const data = await res.json()
  console.log('Templates returned for PiPixel with Dev Token:', JSON.stringify(data, null, 2))
}

checkDevTokenTemplates().then(() => process.exit(0)).catch(console.error)
