import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

async function checkPiPixelBilling() {
  const devToken = process.env.DEV_WHATSAPP_ACCESS_TOKEN
  const pipixelWaba = '1446302204023665'

  // Check WABA fields
  const res = await fetch(`https://graph.facebook.com/v20.0/${pipixelWaba}?fields=id,name,currency,timezone_id,account_review_status,payment_method,primary_funding_id`, {
    headers: { 'Authorization': `Bearer ${devToken}` }
  })
  const data = await res.json()
  console.log('PiPixel WABA details:', JSON.stringify(data, null, 2))

  // Also check phone number fields (messaging_limit_tier, health_status, etc.)
  const pRes = await fetch(`https://graph.facebook.com/v20.0/1301187456416800?fields=id,display_phone_number,messaging_limit_tier,quality_rating,status,account_mode,name_status`, {
    headers: { 'Authorization': `Bearer ${devToken}` }
  })
  const pData = await pRes.json()
  console.log('PiPixel Phone details with Dev token:', JSON.stringify(pData, null, 2))
}

checkPiPixelBilling().then(() => process.exit(0)).catch(console.error)
