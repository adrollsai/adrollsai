/**
 * Detail report for the Joy Grand (Option B) calling run.
 * Shows only the calls that actually CONNECTED, with what was said and what the CRM captured.
 *
 * Usage: node scripts/report-joy-run.mjs [logfile]
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'node:fs'

dotenv.config({ path: '.env.local' })

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const UID = '2f62a259-f23b-48ee-a920-c436f36eaa4b'
const AUTH = 'SA_RUY0ZNCH'
const TOK = 'kbcjLH5cXccdZkbbgkcucE2L2Jeul0vvXrhRuVQo0YxFQAfbFnQ5bzfReUSqs3oi'
const file = process.argv[2] || '.tmp-joyB-run.out'

function cfOf(v) {
  try { return typeof v === 'string' ? JSON.parse(v || '{}') : (v || {}) } catch { return {} }
}

const text = fs.readFileSync(file, 'utf8')
const dispatched = [...text.matchAll(/^\s+ok\s+(\d+)\s+(.*?)\s{2,}(\+\d{10,13})\s+([0-9a-f-]{36})/gm)].map((m) => ({
  seq: Number(m[1]), name: m[2].trim(), phone: m[3], uuid: m[4],
}))

const connected = []
let notAnswered = 0
let shortDrop = 0

for (const c of dispatched) {
  let j = null
  try {
    const r = await fetch('https://api.vobiz.ai/api/v1/Account/' + AUTH + '/Call/' + c.uuid + '/', { headers: { 'X-Auth-ID': AUTH, 'X-Auth-Token': TOK } })
    if (r.ok) j = await r.json()
  } catch {}
  const dur = Number(j && j.bill_duration ? j.bill_duration : 0)
  if (!j || !j.answer_time) { notAnswered++; continue }
  if (dur < 6) { shortDrop++; continue }
  connected.push(Object.assign({}, c, { dur }))
}

const tally = {}
let withBudget = 0
let withTimeline = 0
let qualified = 0
let interested = 0
let booked = 0
const qualifiedList = []

for (const c of connected) {
  const { data } = await db.from('leads')
    .select('name,phone,pipeline_stage,voice_call_status,voice_call_summary,voice_call_transcript,custom_fields,voice_recording_url,booked_time')
    .eq('user_id', UID).ilike('phone', '%' + c.phone.slice(-10) + '%').limit(1)
  const l = data && data[0]
  const cf = cfOf(l && l.custom_fields)
  const st = (l && l.voice_call_status) || 'unknown'
  tally[st] = (tally[st] || 0) + 1
  if (cf.budget) withBudget++
  if (cf.timeline) withTimeline++
  if (cf.is_qualified === true) { qualified++; qualifiedList.push({ l, cf }) }
  if (cf.is_interested === true) interested++
  if (l && l.booked_time) booked++

  let turns = []
  let t = l && l.voice_call_transcript
  try { if (typeof t === 'string') t = JSON.parse(t) } catch {}
  if (Array.isArray(t)) turns = t

  console.log('\n' + '='.repeat(78))
  console.log('#' + c.seq + '  ' + (l && l.name ? l.name : c.name) + '  ' + c.phone + '  [' + c.dur + 's]')
  console.log('  stage=' + (l && l.pipeline_stage) + '  status=' + st + '  rec=' + (l && l.voice_recording_url ? 'y' : 'n'))
  console.log('  budget=' + (cf.budget || '-') + ' | timeline=' + (cf.timeline || '-') + ' | qualified=' + cf.is_qualified + ' | interested=' + cf.is_interested)
  console.log('  summary: ' + String((l && l.voice_call_summary) || '(none)').slice(0, 320))
  if (turns.length) {
    for (const x of turns.slice(0, 8)) {
      console.log('    ' + (x.role === 'agent' ? 'AGENT   ' : 'PROSPECT') + ': ' + String(x.message || '').slice(0, 160))
    }
  }
}

console.log('\n' + '='.repeat(78))
console.log('RUN TOTALS')
console.log('  dispatched        : ' + dispatched.length)
console.log('  connected (>=6s)  : ' + connected.length)
console.log('  never answered    : ' + notAnswered)
console.log('  dropped under 6s  : ' + shortDrop)
console.log('  CRM statuses      : ' + JSON.stringify(tally))
console.log('  budget captured   : ' + withBudget)
console.log('  timeline captured : ' + withTimeline)
console.log('  qualified         : ' + qualified)
console.log('  interested        : ' + interested)
console.log('  booked            : ' + booked)
if (qualifiedList.length) {
  console.log('\n  QUALIFIED LEADS:')
  for (const q of qualifiedList) {
    console.log('   - ' + q.l.name + ' (' + q.l.phone + ') budget=' + (q.cf.budget || '-') + ' timeline=' + (q.cf.timeline || '-'))
  }
}
