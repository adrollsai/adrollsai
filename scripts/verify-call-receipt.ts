/* eslint-disable @typescript-eslint/no-explicit-any --
 * Harness: Supabase rows, Graph payloads and mail bodies are untyped here on purpose.
 */
/**
 * The AI call recording has to reach the owner on both channels.
 *
 *   npx esbuild scripts/verify-call-receipt.ts --bundle --platform=node --format=cjs \
 *     --outfile=.tmp-callreceipt.cjs --log-level=warning --external:@supabase/supabase-js \
 *   && node .tmp-callreceipt.cjs
 *
 * No database, no SMTP, no Graph call: lib/automation/call-receipt.ts takes every
 * side effect as a dependency, so these are statements about what the owner
 * would actually receive.
 *
 * What is checked:
 *   a. an interested lead produces an email with an absolute, playable link
 *   b. the WhatsApp message carries the recording, or degrades to a text alert
 *      that still carries the link
 *   c. outbound test mode redirects both recipients
 *   d. a retried webhook does not send the same receipt twice
 *   e. a failing recording URL / audio step still delivers the text alert
 *  plus: link signing (fresh / tampered / expired), and the "no recording" and
 *  "nothing delivered" cases, which must not page anybody or eat the retry.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import {
  buildRecordingUrl,
  deliverCallReceipt,
  isCallReceiptOutcome,
  outcomeLabel,
  verifyRecordingToken,
  WHATSAPP_MAX_AUDIO_BYTES,
  WHATSAPP_MAX_DOCUMENT_BYTES,
  type CallReceiptStore,
} from '../lib/automation/call-receipt'

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++
  } else {
    failed++
    failures.push(name + (detail ? ` — ${detail}` : ''))
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/**
 * Outbound test mode lives in lib/automation/test-mode.ts and deliberately reads
 * process.env (that is the one choke point every channel goes through), so each
 * scenario sets the environment it wants and the previous one is restored after.
 */
const ENV_KEYS = ['OUTBOUND_TEST_MODE', 'OUTBOUND_TEST_NUMBER', 'OUTBOUND_TEST_EMAIL', 'NEXT_PUBLIC_APP_URL', 'RECORDING_LINK_SECRET']

async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {}
  for (const key of ENV_KEYS) saved[key] = process.env[key]
  for (const key of ENV_KEYS) {
    if (env[key] === undefined) delete process.env[key]
    else process.env[key] = env[key]
  }
  try {
    return await fn()
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const APP_URL = 'https://app.nobogent.com'
const SECRET = 'test-recording-secret'
const OWNER_EMAIL = 'owner@brokerage.example'
const OWNER_PHONE = '9876543210'
const LEAD_ID = '9f1c0a2e-0000-4000-8000-000000000001'
const CALL_ID = 'call-abc-123'
/** Vobiz-style media URL: needs X-Auth-ID headers, so it is unusable outside the server. */
const PROVIDER_RECORDING = 'https://media.vobiz.ai/records/111222333/xyz.mp3'
const PUBLIC_RECORDING = 'https://xyz.supabase.co/storage/v1/object/public/lead-voice-recordings/lead/vobiz_1.mp3'

const TEST_ENV: Record<string, string | undefined> = {
  OUTBOUND_TEST_MODE: 'true',
  OUTBOUND_TEST_NUMBER: '918288835235',
  OUTBOUND_TEST_EMAIL: 'founder@example.com',
  NEXT_PUBLIC_APP_URL: APP_URL,
  RECORDING_LINK_SECRET: SECRET,
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
}

const LIVE_ENV: Record<string, string | undefined> = {
  OUTBOUND_TEST_MODE: 'false',
  OUTBOUND_TEST_NUMBER: '918288835235',
  OUTBOUND_TEST_EMAIL: 'founder@example.com',
  NEXT_PUBLIC_APP_URL: APP_URL,
  RECORDING_LINK_SECRET: SECRET,
}

const NOW = new Date('2026-11-12T15:00:00.000Z')

/** One lead, one finished call with a recording. */
function makeStore(overrides: Partial<CallReceiptStore> & { lead?: any; callLog?: any; history?: any } = {}) {
  const claimed = new Set<string>()
  const baseLead = {
    id: LEAD_ID,
    name: 'Raman Kapoor',
    phone: '9876500011',
    voice_recording_url: PROVIDER_RECORDING,
    voice_call_id: CALL_ID,
    voice_call_summary: 'Asked about pricing and the next available slot.',
  }
  const lead = overrides.lead === undefined ? baseLead : overrides.lead

  const store: CallReceiptStore = {
    async loadLead() {
      return lead
    },
    async loadCallLogRecording() {
      return overrides.callLog === undefined ? null : overrides.callLog
    },
    async loadHistoryRecording() {
      return overrides.history === undefined ? null : overrides.history
    },
    async claimReceipt(_leadId: string, key: string) {
      if (claimed.has(key)) return false
      claimed.add(key)
      return true
    },
    async releaseReceipt(_leadId: string, key: string) {
      claimed.delete(key)
    },
    ...overrides,
  }

  return { store, claimed }
}

interface Sent {
  to: string
  subject: string
  html: string
  text: string
}

function makeEmailSink() {
  const sent: Sent[] = []
  const sendEmail = async (args: Sent) => {
    sent.push(args)
    return { success: true as const, messageId: `msg-${sent.length}` }
  }
  return { sent, sendEmail }
}

type PostResult = { ok: boolean; error?: string }

/** Records every Graph payload. `fail(kind)` decides per message type what the channel answers. */
function makeGraphSink(fail?: (kind: string) => 'reject' | 'throw' | null) {
  const payloads: any[] = []
  const post = async ({ payload }: { url: string; token: string; payload: any }): Promise<PostResult> => {
    payloads.push(payload)
    const verdict = fail ? fail(String(payload?.type || '')) : null
    if (verdict === 'throw') throw new Error('graph exploded')
    if (verdict === 'reject') return { ok: false, error: 'unsupported media' }
    return { ok: true }
  }
  return { payloads, post }
}

/* ------------------------------------------------------------------ */
/* 1. purity                                                           */
/* ------------------------------------------------------------------ */
function testPurity() {
  console.log('\n— module shape —')
  const candidates = [
    path.join(__dirname, 'lib', 'automation', 'call-receipt.ts'),
    path.join(__dirname, '..', 'lib', 'automation', 'call-receipt.ts'),
    path.resolve(process.cwd(), 'lib', 'automation', 'call-receipt.ts'),
  ]
  const srcPath = candidates.find((p) => fs.existsSync(p))
  check('the module source is readable', !!srcPath, candidates.join(' | '))
  if (!srcPath) return
  const src = fs.readFileSync(srcPath, 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  check('module never opens a Supabase client', !/createClient|\.from\('/.test(code))
  check('module never opens an SMTP transport itself', !/nodemailer|SMTP_HOST/i.test(code))
  check('module never performs the network call itself', !/fetch\s*\(/.test(code))
  check('module does not reach into process.env for the owner recipients', !/whatsapp_personal_number/.test(code))
  check('module redirects recipients through lib/automation/test-mode', /from '\.\/test-mode'/.test(code))
  check('every outcome we page on is declared', ['interested', 'appointment_booked', 'callback', 'handoff'].every(isCallReceiptOutcome))
  check('an ordinary finished call is not paged', !isCallReceiptOutcome('no_answer') && !isCallReceiptOutcome(undefined))
  check('outcome labels are industry-neutral', !/propert|listing|site visit|bhk/i.test(Object.keys({ interested: 1, appointment_booked: 1, callback: 1, handoff: 1 }).map((k) => outcomeLabel(k as any)).join(' ')))
}

/* ------------------------------------------------------------------ */
/* 2. absolute, playable links + signatures                            */
/* ------------------------------------------------------------------ */
function testLinks() {
  console.log('\n— recording links —')

  const proxied = buildRecordingUrl({ leadId: LEAD_ID, rawUrl: PROVIDER_RECORDING, appUrl: APP_URL, secret: SECRET, now: NOW })
  check('a provider URL is not handed to the recipient raw', !!proxied && !proxied.includes('media.vobiz.ai'), String(proxied))
  check('the link is absolute', !!proxied && proxied.startsWith('https://'), String(proxied))
  check('the link points at our stream route', !!proxied && proxied.includes('/api/voice/recording/stream?'), String(proxied))
  check('the link carries an expiry', !!proxied && /[?&]exp=\d+/.test(proxied), String(proxied))
  check('the link is signed', !!proxied && /[?&]sig=[0-9a-f]+/.test(proxied), String(proxied))

  const redirect = buildRecordingUrl({ leadId: LEAD_ID, rawUrl: PUBLIC_RECORDING, appUrl: APP_URL, secret: SECRET, now: NOW })
  check('an already-public recording is linked directly', redirect === PUBLIC_RECORDING, String(redirect))

  const relative = buildRecordingUrl({ leadId: LEAD_ID, rawUrl: '/audio/call.mp3', appUrl: APP_URL, secret: SECRET, now: NOW })
  check('a relative path never leaves the server', !!relative && relative.startsWith(`${APP_URL}/api/voice/recording/stream?`), String(relative))

  const params = new URL(String(proxied)).searchParams
  const leadId = params.get('leadId') as string
  const expiresAt = Number(params.get('exp'))
  const signature = params.get('sig') as string
  check(
    'a fresh link verifies',
    verifyRecordingToken({ leadId, expiresAt, signature, secret: SECRET, now: NOW })
  )
  check(
    'a tampered signature is refused',
    !verifyRecordingToken({ leadId, expiresAt, signature: signature.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')), secret: SECRET, now: NOW })
  )
  check(
    'a link for another lead is refused',
    !verifyRecordingToken({ leadId: 'someone-else', expiresAt, signature, secret: SECRET, now: NOW })
  )
  check(
    'an expired link is refused',
    !verifyRecordingToken({ leadId, expiresAt, signature, secret: SECRET, now: new Date((expiresAt + 60) * 1000) })
  )
}

/* ------------------------------------------------------------------ */
/* (a) email carries an absolute recording link                        */
/* ------------------------------------------------------------------ */
async function testInterestedEmail() {
  console.log('\n— (a) interested lead gets a playable link by email —')
  const { store } = makeStore()
  const mail = makeEmailSink()
  const graph = makeGraphSink()

  const result = await deliverCallReceipt(
    { store, post: graph.post, sendEmail: mail.sendEmail, env: TEST_ENV, now: () => NOW, log: () => {} },
    {
      leadId: LEAD_ID,
      outcome: 'interested',
      callId: CALL_ID,
      leadName: 'Raman Kapoor',
      leadPhone: '9876500011',
      summary: 'Asked about pricing and the next available slot.',
      businessName: 'Test Brokerage',
      emailTo: OWNER_EMAIL,
      whatsappTo: OWNER_PHONE,
      whatsappToken: 'waba-token',
      whatsappPhoneId: '1185499271314063',
      crmUrl: `${APP_URL}/dashboard/crm/${LEAD_ID}`,
    }
  )

  check('the email was sent', result.email === 'sent', JSON.stringify(result))
  check('exactly one email was sent', mail.sent.length === 1, `sent ${mail.sent.length}`)

  const email = mail.sent[0] || ({} as Sent)
  const linkMatch = /https:\/\/[^\s"'<]+api\/voice\/recording\/stream\?[^\s"'<]+/.exec(`${email.html} ${email.text}`)
  check('the email contains a recording link', !!linkMatch, email.html?.slice(0, 120))
  check('the link is absolute', !!linkMatch && linkMatch[0].startsWith('https://'), String(linkMatch?.[0]))
  check('the link is not the auth-protected provider URL', !/media\.vobiz\.ai/.test(String(linkMatch?.[0])), String(linkMatch?.[0]))
  check('the link is signature-protected', /[?&](?:amp;)?sig=/.test(String(linkMatch?.[0])), String(linkMatch?.[0]))
  check('the link expires', /[?&](?:amp;)?exp=\d+/.test(String(linkMatch?.[0])), String(linkMatch?.[0]))
  check('the html link is clickable', /<a [^>]*href="https:\/\/[^"]+api\/voice\/recording\/stream/.test(email.html || ''))
  check('the plain-text part also carries the link', /https:\/\/\S+api\/voice\/recording\/stream/.test(email.text || ''))
  check('the subject names the lead and the outcome', /AI call recording/i.test(email.subject || '') && /Raman Kapoor/.test(email.subject || ''), email.subject)
  check('the summary rides along', /Asked about pricing/.test(email.html || ''))

  return result
}

/* ------------------------------------------------------------------ */
/* (b) WhatsApp carries the recording, or degrades to a link           */
/* ------------------------------------------------------------------ */
async function testWhatsAppRecording() {
  console.log('\n— (b) WhatsApp carries the recording, or degrades to a link —')

  const { store } = makeStore()
  const mail = makeEmailSink()
  const graph = makeGraphSink()
  const result = await deliverCallReceipt(
    { store, post: graph.post, sendEmail: mail.sendEmail, env: TEST_ENV, now: () => NOW, log: () => {} },
    {
      leadId: LEAD_ID,
      outcome: 'appointment_booked',
      callId: CALL_ID,
      leadName: 'Raman Kapoor',
      leadPhone: '9876500011',
      businessName: 'Test Academy',
      emailTo: OWNER_EMAIL,
      whatsappTo: OWNER_PHONE,
      whatsappToken: 'waba-token',
      whatsappPhoneId: '1185499271314063',
    }
  )

  check('whatsapp delivered the recording as a document', result.whatsapp === 'document', String(result.whatsapp))
  const doc = graph.payloads[0]
  check('the first WhatsApp message is the recording', doc?.type === 'document', JSON.stringify(doc?.type))
  check('the document link is our absolute stream URL', typeof doc?.document?.link === 'string' && doc.document.link.startsWith(`${APP_URL}/api/voice/recording/stream?`), JSON.stringify(doc?.document?.link))
  check('the document has a filename and a caption', !!doc?.document?.filename && !!doc?.document?.caption, JSON.stringify(doc?.document || {}))
  check('the caption says what happened', /Appointment booked/i.test(String(doc?.document?.caption || '')), String(doc?.document?.caption))

  // Document and audio both rejected by the channel -> the alert must still go out.
  const fallbackStore = makeStore()
  const fallbackGraph = makeGraphSink((kind) => (kind === 'text' ? null : 'reject'))
  const fallback = await deliverCallReceipt(
    { store: fallbackStore.store, post: fallbackGraph.post, sendEmail: makeEmailSink().sendEmail, env: TEST_ENV, now: () => NOW, log: () => {} },
    {
      leadId: LEAD_ID,
      outcome: 'callback',
      callId: CALL_ID,
      leadName: 'Raman Kapoor',
      emailTo: OWNER_EMAIL,
      whatsappTo: OWNER_PHONE,
      whatsappToken: 'waba-token',
      whatsappPhoneId: '1185499271314063',
      crmUrl: `${APP_URL}/dashboard/crm/${LEAD_ID}`,
    }
  )

  check('a rejected media message falls back to text', fallback.whatsapp === 'text', String(fallback.whatsapp))
  check('the fallback is a text message', fallbackGraph.payloads[2]?.type === 'text', JSON.stringify(fallbackGraph.payloads.map((p) => p?.type)))
  const fallbackBody = String(fallbackGraph.payloads[2]?.text?.body || '')
  check('the fallback text still carries the recording link', /https:\/\/\S+api\/voice\/recording\/stream\?/.test(fallbackBody), fallbackBody.slice(0, 160))
  check('the fallback text carries the CRM link too', fallbackBody.includes(`${APP_URL}/dashboard/crm/${LEAD_ID}`), fallbackBody.slice(0, 160))
  check('the fallback text names the outcome', /Callback requested/i.test(fallbackBody), fallbackBody.slice(0, 80))

  // A recording bigger than Meta's audio cap must skip straight to the milder form.
  const bigStore = makeStore()
  const bigGraph = makeGraphSink()
  const big = await deliverCallReceipt(
    { store: bigStore.store, post: bigGraph.post, sendEmail: makeEmailSink().sendEmail, env: TEST_ENV, now: () => NOW, log: () => {} },
    {
      leadId: LEAD_ID,
      outcome: 'interested',
      callId: CALL_ID,
      emailTo: OWNER_EMAIL,
      whatsappTo: OWNER_PHONE,
      whatsappToken: 'waba-token',
      whatsappPhoneId: '1185499271314063',
      recordingBytes: WHATSAPP_MAX_AUDIO_BYTES + 1024,
    }
  )
  check('a recording above the audio cap still goes as a document', big.whatsapp === 'document', String(big.whatsapp))
  check('the audio caps are the documented ones', WHATSAPP_MAX_DOCUMENT_BYTES > WHATSAPP_MAX_AUDIO_BYTES)

  return result
}

/* ------------------------------------------------------------------ */
/* (c) test mode redirects both recipients                             */
/* ------------------------------------------------------------------ */
async function testModeRedirect() {
  console.log('\n— (c) test mode redirects both recipients —')

  const testOn = await withEnv(TEST_ENV, async () => {
    const { store } = makeStore()
    const mail = makeEmailSink()
    const graph = makeGraphSink()
    const result = await deliverCallReceipt(
      { store, post: graph.post, sendEmail: mail.sendEmail, env: TEST_ENV, now: () => NOW, log: () => {} },
      {
        leadId: LEAD_ID,
        outcome: 'handoff',
        callId: CALL_ID,
        leadName: 'Raman Kapoor',
        emailTo: OWNER_EMAIL,
        whatsappTo: OWNER_PHONE,
        whatsappToken: 'waba-token',
        whatsappPhoneId: '1185499271314063',
      }
    )
    return { mail, graph, result }
  })

  check('test mode sent the email to the founder inbox', testOn.mail.sent[0]?.to === TEST_ENV.OUTBOUND_TEST_EMAIL, String(testOn.mail.sent[0]?.to))
  check('test mode never emailed the owner', testOn.mail.sent[0]?.to !== OWNER_EMAIL, String(testOn.mail.sent[0]?.to))
  check('test mode sent WhatsApp to the test number', testOn.graph.payloads[0]?.to === TEST_ENV.OUTBOUND_TEST_NUMBER, String(testOn.graph.payloads[0]?.to))
  check('test mode never WhatsApp’d the owner', testOn.graph.payloads[0]?.to !== OWNER_PHONE && testOn.graph.payloads[0]?.to !== `91${OWNER_PHONE}`, String(testOn.graph.payloads[0]?.to))
  check('the test email is labelled as a test', /TEST MODE/i.test(testOn.mail.sent[0]?.text || ''), String(testOn.mail.sent[0]?.text || '').slice(-160))
  check('both channels reported a recipient', !!testOn.result.recipients?.email && !!testOn.result.recipients?.whatsapp, JSON.stringify(testOn.result.recipients))

  // Same call, test mode off: the real owner is the recipient again.
  const live = await withEnv(LIVE_ENV, async () => {
    const { store } = makeStore()
    const mail = makeEmailSink()
    const graph = makeGraphSink()
    await deliverCallReceipt(
      { store, post: graph.post, sendEmail: mail.sendEmail, env: LIVE_ENV, now: () => NOW, log: () => {} },
      {
        leadId: LEAD_ID,
        outcome: 'interested',
        callId: CALL_ID,
        emailTo: OWNER_EMAIL,
        whatsappTo: OWNER_PHONE,
        whatsappToken: 'waba-token',
        whatsappPhoneId: '1185499271314063',
      }
    )
    return { mail, graph }
  })

  check('with test mode off the owner email is used', live.mail.sent[0]?.to === OWNER_EMAIL, String(live.mail.sent[0]?.to))
  check('with test mode off the 91 prefix is applied to the owner phone', live.graph.payloads[0]?.to === `91${OWNER_PHONE}`, String(live.graph.payloads[0]?.to))
  check('with test mode off the email is not labelled a test', !/TEST MODE/i.test(live.mail.sent[0]?.text || ''), '')
  return testOn.result
}

/* ------------------------------------------------------------------ */
/* (d) a retried webhook does not send twice                           */
/* ------------------------------------------------------------------ */
async function testDuplicateWebhook() {
  console.log('\n— (d) a retried webhook sends nothing twice —')

  const { store, claimed } = makeStore()
  const mail = makeEmailSink()
  const graph = makeGraphSink()
  const deps = { store, post: graph.post, sendEmail: mail.sendEmail, env: TEST_ENV, now: () => NOW, log: () => {} }
  const params = {
    leadId: LEAD_ID,
    outcome: 'interested' as const,
    callId: CALL_ID,
    leadName: 'Raman Kapoor',
    emailTo: OWNER_EMAIL,
    whatsappTo: OWNER_PHONE,
    whatsappToken: 'waba-token',
    whatsappPhoneId: '1185499271314063',
  }

  const first = await deliverCallReceipt(deps, params)
  const second = await deliverCallReceipt(deps, params)

  check('the first delivery went out', first.email === 'sent' && first.whatsapp === 'document', JSON.stringify({ email: first.email, wa: first.whatsapp }))
  check('the retry is skipped', second.skipped === 'already_sent', String(second.skipped))
  check('the retry sent no second email', mail.sent.length === 1, `sent ${mail.sent.length}`)
  check('the retry sent no second WhatsApp message', graph.payloads.length === 1, `sent ${graph.payloads.length}`)
  check('the retry kept the same claim key', claimed.size === 1, JSON.stringify([...claimed]))

  // A different call on the same lead is a new receipt.
  const third = await deliverCallReceipt(deps, { ...params, callId: 'call-def-456' })
  check('a later call still gets its own receipt', third.email === 'sent', String(third.skipped))
  check('two calls held two claims', claimed.size === 2, JSON.stringify([...claimed]))
}

/* ------------------------------------------------------------------ */
/* (e) a broken recording never loses the alert                        */
/* ------------------------------------------------------------------ */
async function testFailureDoesNotLoseTheAlert() {
  console.log('\n— (e) a failing audio step still delivers the text alert —')

  // The media endpoints throw (not just reject). The text alert must still go.
  const { store } = makeStore()
  const mail = makeEmailSink()
  const graph = makeGraphSink((kind) => (kind === 'text' ? null : 'throw'))
  const result = await deliverCallReceipt(
    { store, post: graph.post, sendEmail: mail.sendEmail, env: TEST_ENV, now: () => NOW, log: () => {} },
    {
      leadId: LEAD_ID,
      outcome: 'interested',
      callId: CALL_ID,
      leadName: 'Raman Kapoor',
      emailTo: OWNER_EMAIL,
      whatsappTo: OWNER_PHONE,
      whatsappToken: 'waba-token',
      whatsappPhoneId: '1185499271314063',
      crmUrl: `${APP_URL}/dashboard/crm/${LEAD_ID}`,
    }
  )
  check('the thrown media step did not escape', !!result, JSON.stringify(result))
  check('the alert still arrived as text', result.whatsapp === 'text', String(result.whatsapp))
  check('the text alert carries the recording link', /https:\/\/\S+api\/voice\/recording\/stream\?/.test(String(graph.payloads.at(-1)?.text?.body || '')))
  check('the email still went out', result.email === 'sent', String(result.email))
  check('the failures are reported, not swallowed', result.errors.length > 0, result.errors.join(' | '))

  // The whole recording lookup explodes: the receipt must not throw into the caller's alert.
  const brokenStore = makeStore({
    loadLead: async () => {
      throw new Error('supabase is down')
    },
    loadCallLogRecording: async () => {
      throw new Error('call_logs is down')
    },
    loadHistoryRecording: async () => {
      throw new Error('lead_history is down')
    },
  })
  const brokenMail = makeEmailSink()
  const brokenGraph = makeGraphSink()
  let threw = false
  let brokenResult: any = null
  try {
    brokenResult = await deliverCallReceipt(
      { store: brokenStore.store, post: brokenGraph.post, sendEmail: brokenMail.sendEmail, env: TEST_ENV, now: () => NOW, log: () => {} },
      { leadId: LEAD_ID, outcome: 'interested', callId: CALL_ID, emailTo: OWNER_EMAIL, whatsappTo: OWNER_PHONE, whatsappToken: 'w', whatsappPhoneId: 'p' }
    )
  } catch {
    threw = true
  }
  check('a broken recording lookup does not throw at the caller', !threw)
  check('nothing was invented when the recording is unreadable', brokenMail.sent.length === 0 && brokenGraph.payloads.length === 0, `${brokenMail.sent.length}/${brokenGraph.payloads.length}`)
  check('the skip reason is explicit', brokenResult?.skipped === 'no_recording', String(brokenResult?.skipped))
  check('the lookup errors are kept for the log', (brokenResult?.errors || []).length > 0, JSON.stringify(brokenResult?.errors))

  // Nothing delivered at all: the claim is handed back so a retry can work.
  const releaseStore = makeStore()
  const failingGraph = makeGraphSink(() => 'reject')
  const failingMail = async () => ({ success: false as const, error: 'smtp refused' })
  const failedRun = await deliverCallReceipt(
    { store: releaseStore.store, post: failingGraph.post, sendEmail: failingMail, env: TEST_ENV, now: () => NOW, log: () => {} },
    {
      leadId: LEAD_ID,
      outcome: 'interested',
      callId: CALL_ID,
      emailTo: OWNER_EMAIL,
      whatsappTo: OWNER_PHONE,
      whatsappToken: 'waba-token',
      whatsappPhoneId: '1185499271314063',
    }
  )
  check('a total failure is reported as such', failedRun.skipped === 'no_channel_delivered', String(failedRun.skipped))
  check('the claim was released for the retry', releaseStore.claimed.size === 0, JSON.stringify([...releaseStore.claimed]))
}

/* ------------------------------------------------------------------ */
/* extras                                                              */
/* ------------------------------------------------------------------ */
async function testQuietCases() {
  console.log('\n— quiet cases —')

  const { store } = makeStore({ lead: { id: LEAD_ID, name: 'No Recording', phone: '1', voice_recording_url: null, voice_call_id: CALL_ID } })
  const mail = makeEmailSink()
  const graph = makeGraphSink()
  const none = await deliverCallReceipt(
    { store, post: graph.post, sendEmail: mail.sendEmail, env: TEST_ENV, now: () => NOW, log: () => {} },
    { leadId: LEAD_ID, outcome: 'interested', callId: CALL_ID, emailTo: OWNER_EMAIL, whatsappTo: OWNER_PHONE, whatsappToken: 'w', whatsappPhoneId: 'p' }
  )
  check('a call with no recording sends nothing', none.skipped === 'no_recording' && mail.sent.length === 0 && graph.payloads.length === 0, String(none.skipped))

  const unimportant = await deliverCallReceipt(
    { store, post: graph.post, sendEmail: mail.sendEmail, env: TEST_ENV, now: () => NOW, log: () => {} },
    { leadId: LEAD_ID, outcome: 'no_answer', callId: CALL_ID, emailTo: OWNER_EMAIL }
  )
  check('an uninteresting outcome pages nobody', unimportant.skipped === 'not_an_important_outcome', String(unimportant.skipped))

  // A recording that only exists in call_logs is still found.
  const { store: logStore } = makeStore({ lead: { id: LEAD_ID, name: 'From Call Log', voice_recording_url: null, voice_call_id: CALL_ID }, callLog: { recording_url: PROVIDER_RECORDING } })
  const logMail = makeEmailSink()
  const fromLogs = await deliverCallReceipt(
    { store: logStore, post: makeGraphSink().post, sendEmail: logMail.sendEmail, env: LIVE_ENV, now: () => NOW, log: () => {} },
    { leadId: LEAD_ID, outcome: 'callback', callId: CALL_ID, emailTo: OWNER_EMAIL }
  )
  check('a recording stored only on the call log is still delivered', fromLogs.email === 'sent' && /api\/voice\/recording\/stream/.test(logMail.sent[0]?.html || ''), String(fromLogs.skipped))
}

/* ------------------------------------------------------------------ */

async function main() {
  testPurity()
  testLinks()
  await withEnv(TEST_ENV, async () => {
    await testInterestedEmail()
    await testWhatsAppRecording()
    await testDuplicateWebhook()
    await testFailureDoesNotLoseTheAlert()
    await testQuietCases()
  })
  await testModeRedirect()

  console.log('')
  if (failures.length) {
    console.log('failures:')
    failures.forEach((f) => console.log(`  - ${f}`))
    console.log('')
  }
  console.log(`passed ${passed}   failed ${failed}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error('harness crashed:', err)
  process.exitCode = 1
})
