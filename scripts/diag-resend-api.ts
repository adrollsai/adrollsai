/**
 * Ask Resend what really happened: domain verification + per-email delivery events.
 * The SMTP 250 only means Resend accepted the payload. The API shows the truth.
 */

import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const KEY = process.env.SMTP_PASS
const auth = { Authorization: `Bearer ${KEY}` }

async function api(path: string) {
  const res = await fetch(`https://api.resend.com${path}`, { headers: auth })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, text }
}

async function main() {
  console.log('=== DOMAINS ===')
  const d = await api('/domains')
  if (d.status !== 200) {
    console.log(`  HTTP ${d.status}: ${d.text.slice(0, 300)}`)
  } else {
    for (const dom of d.json?.data ?? []) {
      console.log(`  ${dom.name}  status=${dom.status}  region=${dom.region}`)
      console.log(`    capabilities: ${JSON.stringify(dom.capabilities ?? dom.records ? 'see records' : {})}`)
      for (const r of dom.records ?? []) {
        console.log(`    ${String(r.record).padEnd(6)} ${String(r.name).padEnd(40)} status=${r.status}`)
      }
    }
  }

  console.log('\n=== TEST EMAIL STATUS (the one just sent) ===')
  const id = '01a1fc85-494d-7b5e-9ef1-9cf77b96eda0'
  const e = await api(`/emails/${id}`)
  if (e.status !== 200) {
    console.log(`  HTTP ${e.status}: ${e.text.slice(0, 300)}`)
  } else {
    console.log(JSON.stringify(e.json, null, 2).slice(0, 1800))
  }

  console.log('\n=== RECENT EMAILS (last 10) ===')
  const list = await api('/emails?limit=10')
  if (list.status !== 200) {
    console.log(`  HTTP ${list.status}: ${list.text.slice(0, 300)}`)
  } else {
    for (const m of list.json?.data ?? []) {
      console.log(`  ${m.created_at ?? ''}  to=${JSON.stringify(m.to)}  last_event=${m.last_event}  ${String(m.subject).slice(0, 50)}`)
    }
  }
}

main()
