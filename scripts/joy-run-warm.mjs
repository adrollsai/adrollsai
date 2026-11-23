import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'node:fs'

dotenv.config({ path: '.env.local' })

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const UID = '2f62a259-f23b-48ee-a920-c436f36eaa4b'

const text = fs.readFileSync('.tmp-joyB-run.out', 'utf8')
const phones = [...new Set([...text.matchAll(/^\s+ok\s+\d+.*?(\+\d{10,13})/gm)].map((m) => m[1]))]

function cfOf(v) {
  try { return typeof v === 'string' ? JSON.parse(v || '{}') : (v || {}) } catch { return {} }
}

console.log('leads in this run that gave ANY qualification data:\n')
for (const p of phones) {
  const { data } = await db.from('leads')
    .select('name,phone,pipeline_stage,custom_fields,booked_time,voice_call_summary')
    .eq('user_id', UID).ilike('phone', '%' + p.slice(-10) + '%').limit(1)
  const l = data && data[0]
  if (!l) continue
  const cf = cfOf(l.custom_fields)
  if (!cf.budget && !cf.timeline && cf.is_qualified !== true && !l.booked_time) continue
  console.log('- ' + l.name + ' (' + l.phone + ')  stage=' + l.pipeline_stage)
  console.log('    budget=' + (cf.budget || '-') + ' | timeline=' + (cf.timeline || '-') + ' | qualified=' + cf.is_qualified + ' | interested=' + cf.is_interested)
  if (l.booked_time) console.log('    BOOKED: ' + l.booked_time)
  console.log('    ' + String(l.voice_call_summary || '').slice(0, 240))
  console.log('')
}
