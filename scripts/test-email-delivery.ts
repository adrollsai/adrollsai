import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
process.env.OUTBOUND_TEST_MODE = 'false'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

async function main() {
  const { sendLeadNotificationEmail, sendGenericEmail, resolveNotificationRecipients } = await import('@/utils/email-helper')

  // prove the earlier failing test used the wrong signature
  console.log('sendGenericEmail arity:', (sendGenericEmail as any).length)

  const { data: p } = await db
    .from('profiles')
    .select('id,email,business_name,role')
    .eq('id', '2f62a259-f23b-48ee-a920-c436f36eaa4b')
    .single()

  const r = resolveNotificationRecipients(p as any)
  console.log('resolved to:', r.toEmail)

  console.log('\n=== TEST 1: sendLeadNotificationEmail (exactly what the live path calls) ===')
  try {
    await sendLeadNotificationEmail({
      to: r.toEmail,
      subject: 'TEST: Blue Square Infra - hot lead alert delivery check',
      leadName: 'Delivery Test',
      leadPhone: '+919999999999',
      businessName: p?.business_name || 'Blue Square Infra',
      buttonClicked: 'Interested',
      crmUrl: 'https://app.nobogent.com/dashboard/crm',
      chatUrl: 'https://app.nobogent.com/dashboard/crm',
      callSummary: 'This is a delivery test. If you can read this, email alerts reach you.',
    })
    console.log('  -> returned WITHOUT throwing (so notification-helper would log SUCCESS)')
  } catch (e: any) {
    console.log(`  -> THREW: ${e?.message}`)
  }

  console.log('\n=== TEST 2: sendGenericEmail (correct signature) ===')
  try {
    await (sendGenericEmail as any)(p?.email, 'TEST: generic email path', '<p>generic path test</p>')
    console.log('  -> returned WITHOUT throwing')
  } catch (e: any) {
    console.log(`  -> THREW: ${e?.message}`)
  }
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
