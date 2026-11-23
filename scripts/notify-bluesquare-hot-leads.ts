/**
 * Blue Square Infra - activate admin notifications and re-send the pending ones.
 *
 * WHY THIS IS NEEDED
 *  1. `profiles.notification_preferences` is NULL. normalizeUserPreferences()
 *     merges the admin defaults, so email+whatsapp ARE on for the categories it
 *     keeps - but it only preserves SIX keys (utils/notification-preferences.ts:175-182).
 *     Preferences for `call_outcome`, `approval_request`, `credits_low` and
 *     `automation_failure` are silently DROPPED, so categoryConfig is undefined
 *     for them and both email and whatsapp fall to false. We therefore write an
 *     explicit object for the six keys that survive.
 *
 *  2. WhatsApp admin alerts are currently redirected to the founder because
 *     OUTBOUND_TEST_MODE=true (notification-helper.ts:677 -> outboundRecipient).
 *     This script flips that flag IN ITS OWN PROCESS ONLY so the resend reaches
 *     the client's real number. It does NOT change the deployed environment.
 *
 *  3. Re-sends with skipPush=true: the in-app rows and pushes already fired, so
 *     this adds only the missing email + WhatsApp legs.
 *
 * RUN
 *   npx esbuild scripts/notify-bluesquare-hot-leads.ts --bundle --platform=node \
 *     --format=cjs --packages=external --alias:@=./ --outfile=.tmp-notify.cjs
 *   node .tmp-notify.cjs --dry-run
 *   node .tmp-notify.cjs
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

// Deliver to the real client rather than the founder (process-local only).
process.env.OUTBOUND_TEST_MODE = 'false'

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

const UID = '2f62a259-f23b-48ee-a920-c436f36eaa4b'
const dryRun = process.argv.includes('--dry-run')
const LOOKBACK_DAYS = Number(process.argv.find((a) => a.startsWith('--days='))?.split('=')[1] || 3)
const SINCE_HOURS = Number(process.argv.find((a) => a.startsWith('--since-hours='))?.split('=')[1] || 0)
const MAX_SEND = Number(process.argv.find((a) => a.startsWith('--max='))?.split('=')[1] || 25)
/**
 * Comma-separated substrings; any pending alert whose title contains one is
 * skipped. Used to withhold a booking the caller did not deserve - e.g. a
 * "site visit booked" for a prospect who was actually asking about a job.
 */
const SKIP_TITLES = String(process.argv.find((a) => a.startsWith('--skip='))?.split('=')[1] || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

/**
 * The six keys normalizeUserPreferences actually preserves. Anything else here
 * would be dropped, so writing it would be a silent no-op.
 */
const PREFERENCES = {
  fresh_lead: { push: true, email: true, whatsapp: true },
  lead_assigned: { push: true, email: true, whatsapp: true },
  meeting_booked: { push: true, email: true, whatsapp: true },
  expert_escalation: { push: true, email: true, whatsapp: true },
  crm_reminder: { push: true, email: false, whatsapp: false },
  system_update: { push: true, email: false, whatsapp: false },
}

/** Types worth re-sending to a human: a hot lead or a booked slot. */
const RESEND_TYPES = ['expert_escalation', 'lead_interested', 'meeting_booked', 'connect_expert']

async function main() {
  const { data: profile } = await db
    .from('profiles')
    .select('role,email,whatsapp_personal_number,contact_number,whatsapp_phone_number,notification_preferences')
    .eq('id', UID)
    .single()

  console.log('\n=== BLUE SQUARE NOTIFICATIONS ===')
  console.log(`role                      ${profile?.role}`)
  console.log(`admin email               ${profile?.email}`)
  console.log(`admin whatsapp            ${profile?.whatsapp_phone_number || profile?.whatsapp_personal_number || profile?.contact_number}`)
  console.log(`prefs before              ${JSON.stringify(profile?.notification_preferences)}`)
  console.log(`OUTBOUND_TEST_MODE (proc) ${process.env.OUTBOUND_TEST_MODE}  <- process-local override\n`)

  if (dryRun) {
    console.log('[dry] would write preferences:')
    console.log(JSON.stringify(PREFERENCES, null, 2))
  } else {
    const { error } = await db.from('profiles').update({ notification_preferences: PREFERENCES }).eq('id', UID)
    console.log(error ? `  x prefs update failed: ${error.message}` : '  ok preferences written (email + whatsapp on for fresh_lead, lead_assigned, meeting_booked, expert_escalation)')
  }

  // ---- what is pending? ----
  const since = SINCE_HOURS > 0
    ? new Date(Date.now() - SINCE_HOURS * 3600e3).toISOString()
    : new Date(Date.now() - LOOKBACK_DAYS * 86400e3).toISOString()
  const { data: pending } = await db
    .from('notifications')
    .select('id,type,title,message,action_link,created_at')
    .eq('user_id', UID)
    .in('type', RESEND_TYPES)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MAX_SEND)

  const pendingAll = (pending ?? []).filter((n) => {
    const t = String(n.title || '').toLowerCase()
    return !SKIP_TITLES.some((s) => t.includes(s))
  })
  if (pendingAll.length !== (pending ?? []).length) {
    console.log(`  (withheld ${(pending ?? []).length - pendingAll.length} alert(s) matching --skip)`)
  }

  console.log(`\n=== pending hot-lead / booking alerts (last ${LOOKBACK_DAYS} days): ${pendingAll.length} ===`)
  for (const n of pendingAll) {
    console.log(`  ${n.created_at.slice(0, 16)}  ${String(n.type).padEnd(18)} ${String(n.title).slice(0, 58)}`)
  }

  if (dryRun) {
    console.log('\n[dry] would re-send the above by email + WhatsApp (skipPush=true)')
    return
  }

  const { sendAdminMultiChannelNotification } = await import('@/utils/notification-helper')

  /**
   * The stored row carries the mapped CATEGORY ("expert_escalation"), but the
   * WhatsApp gate at notification-helper.ts:688-690 only fires for
   * type === 'lead_interested' | 'hot_lead', or a title matching
   * /interested|hot lead/. "High Interest Lead" matches NEITHER, so most hot
   * leads silently fell back to email-only.
   *
   * We re-send with the precise event type the original call meant, which makes
   * isInterestedAlert true and guarantees the WhatsApp template is used.
   */
  const eventTypeFor = (n: { type?: string | null; title?: string | null }) => {
    const t = String(n.type || '')
    const title = String(n.title || '')
    if (t === 'meeting_booked' || /appointment booked|site visit/i.test(title)) return 'meeting_booked'
    if (t === 'expert_escalation' || /interest|hot lead|expert|callback/i.test(title)) return 'lead_interested'
    return t || 'lead_interested'
  }

  let sent = 0
  let failed = 0
  for (const n of pendingAll) {
    // Recover the lead id from the stored action link when present.
    const leadIdMatch = String(n.action_link || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    try {
      await sendAdminMultiChannelNotification({
        ownerUserId: UID,
        title: String(n.title || '🔥 High Interest Lead'),
        body: String(n.message || n.title || ''),
        url: n.action_link || '/dashboard/crm',
        type: eventTypeFor(n),
        leadId: leadIdMatch ? leadIdMatch[0] : undefined,
        skipPush: true, // in-app row + push already happened; add email + WhatsApp only
      })
      sent++
      console.log(`  sent  ${String(n.title).slice(0, 60)}`)
    } catch (e: any) {
      failed++
      console.log(`  FAIL  ${String(n.title).slice(0, 50)}  ${e?.message}`)
    }
    await new Promise((r) => setTimeout(r, 1200))
  }

  console.log(`\n=== RESULT: sent ${sent}, failed ${failed} ===`)
  console.log('Note: this resend used a process-local OUTBOUND_TEST_MODE=false.')
  console.log('For LIVE in-call alerts to reach the client, OUTBOUND_TEST_MODE must be false')
  console.log('in the deployed app env too - otherwise every future WhatsApp goes to the founder.\n')
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
