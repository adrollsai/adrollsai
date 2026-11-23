/**
 * Checks the most recent Joy calls for what city the agent actually said.
 * Joy Grand's catalogue record is "Premium & Luxury Apartment, mohali" (Sector 88),
 * so the correct city is Mohali - "Zirakpur" would be wrong.
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'node:fs'

dotenv.config({ path: '.env.local' })

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const UID = '2f62a259-f23b-48ee-a920-c436f36eaa4b'

const text = fs.readFileSync('.tmp-joyB-run.out', 'utf8')
const phones = [...new Set([...text.matchAll(/^\s+ok\s+\d+.*?(\+\d{10,13})/gm)].map((m) => m[1]))].slice(-14)

let mohali = 0
let zirakpur = 0
let neither = 0

for (const p of phones) {
  const { data } = await db.from('leads')
    .select('name,voice_call_transcript,voice_call_summary')
    .eq('user_id', UID).ilike('phone', '%' + p.slice(-10) + '%').limit(1)
  const l = data && data[0]
  if (!l) continue

  let turns = []
  let t = l.voice_call_transcript
  try { if (typeof t === 'string') t = JSON.parse(t) } catch {}
  if (Array.isArray(t)) turns = t
  const agentSaid = turns.filter((x) => x.role === 'agent').map((x) => String(x.message || '')).join(' ')

  const hasMohali = /mohali/i.test(agentSaid)
  const hasZirakpur = /zirakpur/i.test(agentSaid)
  if (hasMohali && !hasZirakpur) mohali++
  else if (hasZirakpur) zirakpur++
  else neither++

  if (hasMohali || hasZirakpur) {
    console.log('\n' + l.name + '  ' + p)
    console.log('  cities said: ' + (hasMohali ? '[MOHALI] ' : '') + (hasZirakpur ? '[ZIRAKPUR] ' : ''))
    for (const x of turns.filter((y) => y.role === 'agent').slice(0, 4)) {
      const m = String(x.message || '')
      if (/mohali|zirakpur/i.test(m)) console.log('    AGENT: ' + m.slice(0, 190))
    }
  }
}

console.log('\n=== CITY ACCURACY (last ' + phones.length + ' dialled) ===')
console.log('  said Mohali (correct for Joy): ' + mohali)
console.log('  said Zirakpur (wrong for Joy) : ' + zirakpur)
console.log('  named no city                 : ' + neither)
