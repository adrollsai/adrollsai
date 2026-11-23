/**
 * Counts how many dispatched Joy calls actually CONNECTED.
 *
 * "Connected" = Vobiz reports an answer_time AND the call ran at least 6 seconds,
 * which excludes USER_BUSY / NO_USER_RESPONSE and the sub-6s telephony drops.
 *
 * Usage: node scripts/count-joy-connected.mjs [logfile]
 */

import dotenv from 'dotenv'
import fs from 'node:fs'

dotenv.config({ path: '.env.local' })

const AUTH = 'SA_RUY0ZNCH'
const TOK = 'kbcjLH5cXccdZkbbgkcucE2L2Jeul0vvXrhRuVQo0YxFQAfbFnQ5bzfReUSqs3oi'
const file = process.argv[2] || '.tmp-joyB-run.out'

if (!fs.existsSync(file)) {
  console.log('CONNECTED=0 DIALED=0 NOANSWER=0 SHORT=0')
  process.exit(0)
}

const text = fs.readFileSync(file, 'utf8')
const uuids = [...new Set([...text.matchAll(/^\s+ok\s+\d+.*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*$/gm)].map((m) => m[1]))]

let connected = 0
let busy = 0
let shortAnswer = 0

for (let i = 0; i < uuids.length; i += 8) {
  await Promise.all(uuids.slice(i, i + 8).map(async (uuid) => {
    try {
      const r = await fetch('https://api.vobiz.ai/api/v1/Account/' + AUTH + '/Call/' + uuid + '/', {
        headers: { 'X-Auth-ID': AUTH, 'X-Auth-Token': TOK },
      })
      if (!r.ok) return
      const j = await r.json()
      const dur = Number(j.bill_duration ? j.bill_duration : 0)
      if (!j.answer_time) { busy++; return }
      if (dur >= 6) connected++
      else shortAnswer++
    } catch {}
  }))
}

console.log('CONNECTED=' + connected + ' DIALED=' + uuids.length + ' NOANSWER=' + busy + ' SHORT=' + shortAnswer)
