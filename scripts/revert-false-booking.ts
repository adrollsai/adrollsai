/**
 * Revert the false appointment our caller created for Hardil (+919501438401).
 *
 * WHAT HAPPENED
 * The prospect's only interest was asking about a job ("meri job hai"), and the
 * v1 script - whose stated goal was "a booked slot" - booked a site visit anyway.
 * The call record (summary, transcript, recording) is KEPT as evidence; only the
 * appointment is removed, because a fake viewing in the client's CRM is worse
 * than no viewing.
 *
 * RUN
 *   npx esbuild scripts/revert-false-booking.ts --bundle --platform=node \
 *     --format=cjs --packages=external --alias:@=./ --outfile=.tmp-revert.cjs
 *   node .tmp-revert.cjs --dry-run
 *   node .tmp-revert.cjs
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

const LEAD_ID = '5e5d1c2b-0000-0000-0000-000000000000' // replaced below by lookup
const dryRun = process.argv.includes('--dry-run')

async function main() {
  // Find by phone to avoid a hardcoded id.
  const { data: leads, error } = await db
    .from('leads')
    .select('id,name,phone,pipeline_stage,status,booked_time,meet_link,google_calendar_event_id,notes,voice_call_summary')
    .eq('user_id', '2f62a259-f23b-48ee-a920-c436f36eaa4b')
    .ilike('phone', '%9501438401%')

  if (error) throw new Error(error.message)

  const target = (leads ?? []).find((l) => String(l.pipeline_stage || '').toLowerCase().includes('appointment'))
  if (!target) {
    console.log('No booked record found for +919501438401 — nothing to revert.')
    for (const l of leads ?? []) console.log(`  ${l.name} | stage=${l.pipeline_stage} | booked=${l.booked_time ?? 'none'}`)
    return
  }

  console.log('\n=== FOUND FALSE BOOKING ===')
  console.log(`id       ${target.id}`)
  console.log(`name     ${target.name}`)
  console.log(`phone    ${target.phone}`)
  console.log(`stage    ${target.pipeline_stage}`)
  console.log(`booked   ${target.booked_time}`)
  console.log(`summary  ${String(target.voice_call_summary || '').slice(0, 240)}`)

  const note = `[AI CALL CORRECTION ${new Date().toISOString().slice(0, 10)}] The AI caller booked a site visit (${target.booked_time}) for this lead, but the conversation was a JOB enquiry, not a property enquiry. Appointment removed. Booking gate updated so a slot now requires a captured budget AND timeline, and non-property calls book nothing. Call recording and summary retained.`

  if (dryRun) {
    console.log('\n[dry] would clear booked_time / meet_link / calendar event, restore stage, append correction note')
    return
  }

  const { error: updErr } = await db
    .from('leads')
    .update({
      booked_time: null,
      meet_link: null,
      google_calendar_event_id: null,
      pipeline_stage: 'New Lead',
      status: 'New Lead',
      notes: target.notes ? `${note}\n\n${target.notes}` : note,
    })
    .eq('id', target.id)

  if (updErr) {
    console.error(`update failed: ${updErr.message}`)
    process.exit(1)
  }

  try {
    await db.from('lead_history').insert({
      lead_id: target.id,
      user_id: '2f62a259-f23b-48ee-a920-c436f36eaa4b',
      action_type: 'REMARK',
      description: note,
    })
  } catch {}

  console.log('\nok false booking reverted; call record kept')
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
