/**
 * Diagnose why the Blue Square admin received no email or WhatsApp.
 *
 * FINDINGS THIS TESTS
 *  1. notification-helper.ts:673 sends WhatsApp to `whatsapp_personal_number`
 *     FIRST - for this profile that is +91 98724 90091, while the business
 *     WhatsApp on file is +91 98771 32623. If the admin watches the business
 *     number, he never sees these.
 *  2. "[MULTI-CHANNEL WA SUCCESS]" only proves Meta ACCEPTED the API call and
 *     returned a wamid. It is not a delivery receipt.
 *  3. Email is sent from no-reply@mail.nobogent.com via Resend SMTP to
 *     profile.email. "SUCCESS" means the SMTP transport accepted it.
 *
 * This script sends one real template message to EACH candidate number and one
 * real email, printing the raw provider response so we stop guessing.
 *
 * RUN
 *   npx esbuild scripts/diagnose-bluesquare-notifications.ts --bundle --platform=node \
 *     --format=cjs --packages=external --alias:@=./ --outfile=.tmp-diag.cjs
 *   node .tmp-diag.cjs --dry-run
 *   node .tmp-diag.cjs
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
process.env.OUTBOUND_TEST_MODE = 'false' // we want the real recipients here

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

const UID = '2f62a259-f23b-48ee-a920-c436f36eaa4b'
const dryRun = process.argv.includes('--dry-run')

async function main() {
  const { data: p } = await db
    .from('profiles')
    .select('role,email,business_name,whatsapp_personal_number,contact_number,whatsapp_phone_number,whatsapp_phone_number_id,whatsapp_access_token,facebook_token,notification_preferences')
    .eq('id', UID)
    .single()

  const { resolveNotificationRecipients } = await import('@/utils/email-helper')
  const recipients = resolveNotificationRecipients(p as any)

  console.log('\n=== PROFILE DESTINATIONS ===')
  console.log(`role                    ${p?.role}`)
  console.log(`whatsapp_personal_number ${p?.whatsapp_personal_number}`)
  console.log(`contact_number           ${p?.contact_number}`)
  console.log(`whatsapp_phone_number    ${p?.whatsapp_phone_number}   <- business WhatsApp`)
  console.log(`whatsapp_phone_number_id ${p?.whatsapp_phone_number_id ? 'set' : 'MISSING'}`)
  console.log(`whatsapp_access_token    ${p?.whatsapp_access_token ? 'set' : 'MISSING'}`)
  console.log(`facebook_token           ${p?.facebook_token ? 'set' : 'MISSING'}`)
  console.log(`\nemail helper resolves to: to=${recipients.toEmail}  bcc=${recipients.bccEmail ?? 'none'}`)
  console.log(`registered profile email : ${p?.email}`)
  // A diagnostic PROBING whether this column exists: the select above deliberately does not request it, so a
  // plain `p?.notification_email` would be a type error against the query's result shape. Reading it off the row
  // is the point of the line — it reports 'null' when the column is absent, which is the finding.
  console.log(`notification_email       ${(p as any)?.notification_email ?? 'null'}`)

  const token = p?.whatsapp_access_token || p?.facebook_token || process.env.WHATSAPP_ACCESS_TOKEN
  const phoneId = p?.whatsapp_phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID

  // The number the code actually uses today, and the one it ignores.
  const usedToday = String(p?.whatsapp_personal_number || p?.contact_number || p?.whatsapp_phone_number || '').replace(/\D/g, '')
  const business = String(p?.whatsapp_phone_number || '').replace(/\D/g, '')
  const candidates = [
    { label: 'code uses this today (whatsapp_personal_number)', to: usedToday },
    { label: 'business WhatsApp (currently ignored)', to: business },
  ].filter((c) => c.to)

  console.log('\n=== CANDIDATE WHATSAPP DESTINATIONS ===')
  for (const c of candidates) console.log(`  ${c.to}  <- ${c.label}`)

  if (dryRun) {
    console.log('\n[dry] would send one template to each candidate above + one email')
    return
  }

  if (!token || !phoneId) {
    console.error('\nCannot test WhatsApp: missing token or phone_number_id')
  } else {
    console.log('\n=== WHATSAPP SEND TEST ===')
    for (const c of candidates) {
      const payload = {
        messaging_product: 'whatsapp',
        to: c.to,
        type: 'template',
        template: {
          name: 'expert_connection_notification',
          language: { code: 'en_US' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: 'TEST: Blue Square Infra notification check | CRM: https://app.nobogent.com/dashboard/crm' },
                { type: 'text', text: '+919999999999' },
              ],
            },
          ],
        },
      }
      const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.text()
      console.log(`\n  -> ${c.to}  (${c.label})`)
      console.log(`     HTTP ${res.status}`)
      console.log(`     ${body.slice(0, 420)}`)
      await new Promise((r) => setTimeout(r, 1500))
    }
  }

  console.log('\n=== EMAIL SEND TEST ===')
  try {
    const { sendGenericEmail } = await import('@/utils/email-helper')
    await sendGenericEmail(
      String(recipients.toEmail || p?.email),
      'TEST: Blue Square Infra notification check',
      '<p>This is a delivery test from Nobogent. If you received this, email notifications are reaching you.</p>'
    )
    console.log(`  sent via SMTP to ${recipients.toEmail || p?.email} (transport accepted it)`)
    console.log('  NOTE: "accepted" is not "delivered" â€” check the inbox AND the spam folder.')
  } catch (e: any) {
    console.error(`  email FAILED: ${e?.message}`)
  }

  console.log('\nDone. Ask the admin to check BOTH WhatsApp numbers and the email inbox + spam.\n')
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})

