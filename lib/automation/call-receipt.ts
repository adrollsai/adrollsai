/* eslint-disable @typescript-eslint/no-explicit-any --
 * Supabase rows and provider payloads are untyped (generated database.types.ts
 * is stale), matching lib/automation/video-delivery.ts and utils/credits.ts.
 */
/**
 * Call receipt: deliver the AI voice agent's recording to the owner.
 *
 * The problem
 * -----------
 * When a finished voice call produced an outcome worth acting on (lead
 * interested, appointment booked, callback requested, human handoff) the owner
 * got an email and a WhatsApp alert - and neither carried the recording, even
 * though `leads.voice_recording_url`, `call_logs.recording_url` and the
 * `🎙️ CALL_JSON:` history row all held one. Three separate reasons:
 *
 *  1. The alert body interpolated whatever was in the database, which for the
 *     Vobiz / Twilio providers is `media.vobiz.ai/...` or `api.twilio.com/...`
 *     - those need `X-Auth-ID` / basic-auth headers, so a human clicking the
 *     link gets a 401, and Meta cannot fetch it at all.
 *  2. The appointment path (utils/voice-helper.ts `bookAppointment`) passed a
 *     `leadSource`, and utils/notification-helper.ts only resolved a recording
 *     when NO leadSource was supplied. So the busiest alert path never even
 *     looked for the recording.
 *  3. The "high interest" alert renders through the expert-escalation email
 *     template, which has no recording slot, and the WhatsApp admin alert is an
 *     approved text-only template - templates cannot grow a media part.
 *
 * What this module does
 * ---------------------
 * One receipt per call, on both channels, idempotent by call id:
 *
 *   - Email: an absolute, playable link (never the raw provider URL, never a
 *     relative `/api/...` path, which is not clickable in a mail client).
 *   - WhatsApp: the recording as a `document`, downgraded to an `audio` message,
 *     downgraded to a text alert that still carries the link. Layered so a media
 *     rejection can never lose the alert.
 *
 * The link is a signed capability URL into the existing
 * `app/api/voice/recording/stream` route. Chosen over "just use the provider
 * URL" because:
 *   - provider URLs are auth-protected (see above),
 *   - the Supabase `lead-voice-recordings` bucket is public *only* when the
 *     background re-upload in the stream route succeeded; when it did not, the
 *     raw provider URL is all we have,
 *   - a signed, expiring link keeps working through both of those cases and
 *     cannot be re-pointed at another lead's audio (the HMAC covers the lead
 *     id and the expiry).
 *
 * Pure by construction: no Supabase, no nodemailer, no Graph call of its own.
 * Everything external arrives as a dependency, so scripts/verify-call-receipt.ts
 * can exercise the real code path offline with fakes.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

import { resolveAppUrl } from '../../utils/app-url'
import { isOutboundTestMode, outboundEmail, outboundRecipient, testBanner } from './test-mode'

/* ------------------------------------------------------------------ */
/* Outcomes                                                            */
/* ------------------------------------------------------------------ */

export type CallOutcome = 'interested' | 'appointment_booked' | 'callback' | 'handoff'

export const CALL_OUTCOMES: CallOutcome[] = ['interested', 'appointment_booked', 'callback', 'handoff']

/**
 * The four outcomes that are worth the owner's attention. Anything else on a
 * finished call (no answer, not interested, hung up) must not page anybody.
 */
export function isCallReceiptOutcome(value: unknown): value is CallOutcome {
  return typeof value === 'string' && (CALL_OUTCOMES as string[]).includes(value)
}

const OUTCOME_LABELS: Record<CallOutcome, string> = {
  interested: 'Lead interested',
  appointment_booked: 'Appointment booked',
  callback: 'Callback requested',
  handoff: 'Human handoff requested',
}

/** Industry-neutral label - this ships to brokerages, academies and consultancies alike. */
export function outcomeLabel(outcome: CallOutcome): string {
  return OUTCOME_LABELS[outcome] || 'Call completed'
}

/* ------------------------------------------------------------------ */
/* Recording URLs                                                      */
/* ------------------------------------------------------------------ */

/** How long a mailed / WhatsApp'd recording link stays open. */
export const RECORDING_LINK_TTL_SECONDS = 7 * 24 * 60 * 60

/**
 * Provider media hosts that answer only with credentials. A recipient's mail
 * client and Meta's media fetcher both get a hard 401 from these, so they must
 * be proxied through our own stream route instead of linked directly.
 */
const AUTH_PROTECTED_RECORDING_HOSTS = [
  'media.vobiz.ai',
  'media.plivo.com',
  'api.twilio.com',
  'api.exotel.com',
  'recordings.twilio.com',
]

/** Meta's documented per-channel caps. See the report for the ones we could not verify offline. */
export const WHATSAPP_MAX_DOCUMENT_BYTES = 100 * 1024 * 1024 // 100 MB
export const WHATSAPP_MAX_AUDIO_BYTES = 16 * 1024 * 1024 // 16 MB

/** True when the URL is already absolute https and needs no credentials. */
export function isDirectlyFetchableRecordingUrl(raw?: string | null): boolean {
  const value = String(raw || '').trim()
  if (!/^https:\/\//i.test(value)) return false
  let host = ''
  try {
    host = new URL(value).hostname.toLowerCase()
  } catch {
    return false
  }
  if (!host) return false
  return !AUTH_PROTECTED_RECORDING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}

/**
 * Absolute origin for links that leave the product. Mirrors utils/app-url.ts but
 * accepts an explicit override so the offline harness can pin it.
 */
export function normalizeAppUrl(raw?: string | null): string {
  const cleaned = String(raw ?? '')
    .trim()
    .replace(/\/+$/, '')
  if (/^https?:\/\/[^\s]+$/i.test(cleaned) && !/localhost|127\.0\.0\.1/i.test(cleaned)) {
    return cleaned.replace(/^http:\/\//i, 'https://')
  }
  return resolveAppUrl()
}

/**
 * Server secret used to sign recording links. `RECORDING_LINK_SECRET` is the
 * intended knob; the service-role key is the fallback that is already deployed
 * everywhere, so a signed link works without a new env var being pasted in.
 * Never the anon key - that one is public.
 */
export function resolveRecordingLinkSecret(env: Record<string, string | undefined> = process.env): string {
  return String(env.RECORDING_LINK_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_JWT_SECRET || '').trim()
}

function tokenPayload(leadId: string, expiresAt: number): string {
  return `${leadId}:${expiresAt}`
}

export function signRecordingToken(leadId: string, expiresAt: number, secret: string): string {
  return createHmac('sha256', secret).update(tokenPayload(leadId, expiresAt)).digest('hex')
}

/** Constant-time check of a stream-route signature, including expiry. */
export function verifyRecordingToken(params: {
  leadId?: string | null
  expiresAt?: number | null
  signature?: string | null
  secret?: string | null
  now?: Date
}): boolean {
  const leadId = String(params.leadId || '').trim()
  const signature = String(params.signature || '').trim()
  const secret = String(params.secret || '').trim()
  const expiresAt = Number(params.expiresAt)
  if (!leadId || !signature || !secret || !Number.isFinite(expiresAt)) return false

  const nowSeconds = Math.floor((params.now ?? new Date()).getTime() / 1000)
  if (expiresAt <= nowSeconds) return false

  const expected = signRecordingToken(leadId, expiresAt, secret)
  if (expected.length !== signature.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'))
  } catch {
    return false
  }
}

/**
 * The playable URL a human (and Meta) can actually open.
 *
 * - already-public https URL  -> handed over untouched
 * - anything else (provider URL, relative path) -> signed, expiring link into
 *   our own stream route, which resolves and proxies the audio server-side.
 */
export function buildRecordingUrl(params: {
  leadId: string
  rawUrl?: string | null
  appUrl?: string | null
  secret?: string | null
  now?: Date
  ttlSeconds?: number
}): string | null {
  const leadId = String(params.leadId || '').trim()
  if (!leadId) return null

  const raw = String(params.rawUrl || '').trim()
  if (isDirectlyFetchableRecordingUrl(raw)) return raw

  const appUrl = normalizeAppUrl(params.appUrl)
  const ttl = Number.isFinite(Number(params.ttlSeconds)) ? Number(params.ttlSeconds) : RECORDING_LINK_TTL_SECONDS
  const expiresAt = Math.floor((params.now ?? new Date()).getTime() / 1000) + Math.max(60, ttl)

  const query = new URLSearchParams({ leadId, exp: String(expiresAt) })
  const secret = String(params.secret || '').trim()
  if (secret) query.set('sig', signRecordingToken(leadId, expiresAt, secret))

  return `${appUrl}/api/voice/recording/stream?${query.toString()}`
}

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface ReceiptContentInput {
  outcome: CallOutcome
  leadName?: string | null
  leadPhone?: string | null
  businessName?: string | null
  summary?: string | null
  recordingUrl: string
  crmUrl?: string | null
  occurredAt?: Date | string | null
  isTest?: boolean
}

function formatWhen(value?: Date | string | null): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })
}

export function buildReceiptEmail(input: ReceiptContentInput): { subject: string; html: string; text: string } {
  const leadName = String(input.leadName || 'Lead')
  const leadPhone = String(input.leadPhone || 'N/A')
  const label = outcomeLabel(input.outcome)
  const businessName = String(input.businessName || 'Nobogent')
  const when = formatWhen(input.occurredAt)
  const summary = String(input.summary || '').trim()
  const crmUrl = String(input.crmUrl || '').trim()
  const banner = input.isTest === false ? '' : testBanner()

  const subject = `🎙️ AI call recording — ${label}: ${leadName}`

  const metaRows = [
    ['Outcome', label],
    ['Lead', leadName],
    ['Phone', leadPhone],
    when ? ['Call finished', when] : null,
  ]
    .filter(Boolean) as string[][]

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f6f7fb;padding:24px">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e8e8ec;border-radius:16px;overflow:hidden">
    <div style="padding:22px 22px 0">
      <p style="margin:0 0 6px;font-size:12px;font-weight:800;letter-spacing:.08em;color:#64748b;text-transform:uppercase">Call recording — ${escapeHtml(businessName)}</p>
      <h2 style="margin:0 0 6px;font-size:20px;line-height:1.25;color:#0f172a">${escapeHtml(label)}: ${escapeHtml(leadName)}</h2>
      <p style="margin:0 0 16px;font-size:13px;color:#64748b">Your AI voice agent finished this call. The audio and the summary are below.</p>
      <a href="${escapeHtml(input.recordingUrl)}" style="display:inline-block;padding:13px 26px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:12px;font-size:13px;font-weight:800">▶ Play the call recording</a>
      <p style="margin:14px 0 0;font-size:12px;color:#64748b;word-break:break-all">Direct link: <a href="${escapeHtml(input.recordingUrl)}" style="color:#2563eb">${escapeHtml(input.recordingUrl)}</a></p>
    </div>
    <div style="padding:18px 22px 0">
      <table style="width:100%;border-collapse:collapse">
        ${metaRows
          .map(
            ([k, v]) => `<tr>
          <td style="padding:6px 0;width:150px;font-size:12px;font-weight:800;letter-spacing:.04em;color:#64748b;text-transform:uppercase">${escapeHtml(k)}</td>
          <td style="padding:6px 0;font-size:14px;color:#0f172a;font-weight:600">${escapeHtml(v)}</td>
        </tr>`
          )
          .join('')}
      </table>
    </div>
    ${
      summary
        ? `<div style="padding:10px 22px 0">
      <p style="margin:0 0 6px;font-size:12px;font-weight:800;letter-spacing:.06em;color:#64748b">📝 CALL SUMMARY</p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;font-size:13px;line-height:1.6;color:#1e293b;white-space:pre-wrap">${escapeHtml(summary)}</div>
    </div>`
        : ''
    }
    ${
      crmUrl
        ? `<div style="padding:18px 22px 0;text-align:center">
      <a href="${escapeHtml(crmUrl)}" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#ffffff;text-decoration:none;border-radius:10px;font-size:13px;font-weight:800">Open the lead in CRM</a>
    </div>`
        : ''
    }
    <div style="border-top:1px solid #f1f5f9;margin-top:18px;padding:14px 22px;text-align:center;color:#94a3b8;font-size:11px;font-weight:600">
      Sent automatically by Nobogent${escapeHtml(banner)}
    </div>
  </div>
</div>`

  const text = [
    `${label}: ${leadName}`,
    `Phone: ${leadPhone}`,
    when ? `Call finished: ${when}` : null,
    '',
    `Play the call recording: ${input.recordingUrl}`,
    summary ? `\nCall summary: ${summary}` : null,
    crmUrl ? `\nCRM: ${crmUrl}` : null,
    banner,
  ]
    .filter((line) => line !== null && line !== undefined)
    .join('\n')

  return { subject, html, text }
}

/* ------------------------------------------------------------------ */
/* WhatsApp payloads                                                   */
/* ------------------------------------------------------------------ */

export function buildRecordingDocumentPayload(params: {
  to: string
  recordingUrl: string
  caption: string
}): Record<string, any> {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: params.to,
    type: 'document',
    document: {
      link: params.recordingUrl,
      filename: 'call-recording.mp3',
      caption: params.caption.slice(0, 1024),
    },
  }
}

/** Voice-note form. Meta takes no caption here, so the link must come from the fallback. */
export function buildRecordingAudioPayload(params: { to: string; recordingUrl: string }): Record<string, any> {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: params.to,
    type: 'audio',
    audio: { link: params.recordingUrl },
  }
}

export function buildRecordingTextPayload(params: {
  to: string
  title: string
  body: string
  recordingUrl?: string | null
  crmUrl?: string | null
}): Record<string, any> {
  const parts = [params.title, '', params.body]
  if (params.recordingUrl && !params.body.includes(params.recordingUrl)) {
    parts.push('', `🎙️ Call recording: ${params.recordingUrl}`)
  }
  if (params.crmUrl) parts.push('', `🔗 CRM: ${params.crmUrl}`)
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: params.to,
    type: 'text',
    text: { body: parts.join('\n') },
  }
}

/* ------------------------------------------------------------------ */
/* Delivery                                                            */
/* ------------------------------------------------------------------ */

/**
 * The little bit of persistence the receipt needs. Implemented against Supabase
 * in utils/notification-helper.ts (`createCallReceiptStore`), faked in the
 * offline harness.
 */
export interface CallReceiptStore {
  loadLead(leadId: string): Promise<any | null>
  loadCallLogRecording(leadId: string): Promise<{ recording_url?: string | null; summary?: string | null } | null>
  loadHistoryRecording(leadId: string): Promise<string | null>
  /** True when this call id has not been receipted yet (first caller wins). */
  claimReceipt(leadId: string, key: string): Promise<boolean>
  /** Give the claim back so a retry can try again (nothing was delivered). */
  releaseReceipt(leadId: string, key: string): Promise<void>
}

export interface CallReceiptDeps {
  store: CallReceiptStore
  /** POSTs a WhatsApp payload with the tenant's own WABA credentials. */
  post?: (args: { url: string; token: string; payload: Record<string, any> }) => Promise<{ ok: boolean; error?: string }>
  sendEmail?: (args: { to: string; subject: string; html: string; text: string }) => Promise<{ success: boolean; error?: string }>
  env?: Record<string, string | undefined>
  now?: () => Date
  log?: (message: string) => void
}

export interface CallReceiptParams {
  leadId: string
  outcome: CallOutcome | string
  callId?: string | null
  summary?: string | null
  leadName?: string | null
  leadPhone?: string | null
  recordingUrl?: string | null
  crmUrl?: string | null
  businessName?: string | null
  occurredAt?: Date | string | null
  /** Owner's real recipients - this module is the choke point that applies test mode. */
  emailTo?: string | null
  whatsappTo?: string | null
  whatsappToken?: string | null
  whatsappPhoneId?: string | null
  /** Known size, when the caller already measured it. Used only to skip doomed media attempts. */
  recordingBytes?: number | null
  email?: boolean
  whatsapp?: boolean
}

export interface CallReceiptResult {
  skipped?: string
  outcome?: CallOutcome
  recordingUrl?: string | null
  email: 'sent' | 'failed' | 'skipped'
  whatsapp: 'document' | 'audio' | 'text' | 'failed' | 'skipped'
  recipients?: { email?: string; whatsapp?: string }
  errors: string[]
}

function normaliseWaPhone(raw?: string | null): string {
  let phone = String(raw || '').replace(/\D/g, '')
  if (phone.length === 10) phone = `91${phone}`
  return phone
}

async function resolveStoredRecording(deps: CallReceiptDeps, leadId: string, errors: string[]): Promise<string | null> {
  try {
    const callLog = await deps.store.loadCallLogRecording(leadId)
    const fromCallLog = String(callLog?.recording_url || '').trim()
    if (fromCallLog) return fromCallLog
  } catch (e: any) {
    errors.push(`call_logs lookup failed: ${e?.message || e}`)
  }
  try {
    const fromHistory = await deps.store.loadHistoryRecording(leadId)
    const value = String(fromHistory || '').trim()
    if (value) return value
  } catch (e: any) {
    errors.push(`lead_history lookup failed: ${e?.message || e}`)
  }
  return null
}

/**
 * Send the recording for one finished call on every channel that is available.
 *
 * Never throws and never half-fails the caller: an audio problem logs, the text
 * alert still goes, and a webhook retry cannot produce a second receipt.
 */
export async function deliverCallReceipt(
  deps: CallReceiptDeps,
  params: CallReceiptParams
): Promise<CallReceiptResult> {
  const env = deps.env ?? process.env
  const now = deps.now ? deps.now() : new Date()
  const log = deps.log || ((message: string) => console.log(message))
  const result: CallReceiptResult = { email: 'skipped', whatsapp: 'skipped', errors: [] }

  try {
    if (!isCallReceiptOutcome(params.outcome)) {
      return { ...result, skipped: 'not_an_important_outcome' }
    }
    result.outcome = params.outcome

    const leadId = String(params.leadId || '').trim()
    if (!leadId) return { ...result, skipped: 'no_lead_id' }

    // ---- 1. the recording itself -------------------------------------
    let lead: any = null
    try {
      lead = await deps.store.loadLead(leadId)
    } catch (e: any) {
      result.errors.push(`lead lookup failed: ${e?.message || e}`)
    }

    let rawRecording = String(params.recordingUrl || lead?.voice_recording_url || '').trim()
    if (!rawRecording) rawRecording = (await resolveStoredRecording(deps, leadId, result.errors)) || ''
    if (!rawRecording) {
      // Nothing to deliver - the plain text alert (already sent by the caller)
      // is the whole message, which is exactly the intended behaviour.
      return { ...result, skipped: 'no_recording' }
    }

    const recordingUrl = buildRecordingUrl({
      leadId,
      rawUrl: rawRecording,
      appUrl: env.NEXT_PUBLIC_APP_URL || env.APP_URL,
      secret: resolveRecordingLinkSecret(env),
      now,
      ttlSeconds: RECORDING_LINK_TTL_SECONDS,
    })
    if (!recordingUrl) return { ...result, skipped: 'recording_url_unresolved' }
    result.recordingUrl = recordingUrl

    // ---- 2. idempotency, keyed on the call ---------------------------
    const callId = String(params.callId || lead?.voice_call_id || '').trim() || 'latest'
    const receiptKey = `${leadId}:${callId}`
    let claimed = false
    try {
      claimed = await deps.store.claimReceipt(leadId, receiptKey)
    } catch (e: any) {
      // A broken dedupe must not suppress the receipt: send, and let the
      // duplicate risk be visible in the log.
      result.errors.push(`dedupe claim failed: ${e?.message || e}`)
      log(`[CALL RECEIPT] dedupe claim failed for lead ${leadId} - sending anyway: ${e?.message || e}`)
      claimed = true
    }
    if (!claimed) {
      log(`[CALL RECEIPT] already receipted (${receiptKey}) - skipping duplicate delivery`)
      return { ...result, skipped: 'already_sent' }
    }

    const leadName = String(params.leadName || lead?.name || 'Lead')
    const leadPhone = String(params.leadPhone || lead?.phone || 'N/A')
    const summary = String(params.summary || lead?.voice_call_summary || '').trim()
    const isTest = isOutboundTestMode()

    let delivered = false

    // ---- 3. WhatsApp: document -> audio -> text ----------------------
    if (params.whatsapp === false) {
      log('[CALL RECEIPT] WhatsApp recording skipped - channel disabled for this owner')
    } else {
      const token = String(params.whatsappToken || '').trim()
      const phoneId = String(params.whatsappPhoneId || '').trim()
      const to = normaliseWaPhone(outboundRecipient(params.whatsappTo))
      result.recipients = { ...(result.recipients || {}), whatsapp: to || undefined }

      if (!to || !token || !phoneId) {
        log('[CALL RECEIPT] WhatsApp recording skipped - no recipient, WABA token or phone id')
      } else if (deps.post) {
        const graphUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`
        const caption = `🎙️ ${outcomeLabel(params.outcome)} — ${leadName}${summary ? `\n${summary.slice(0, 400)}` : ''}`
        const bytes = Number(params.recordingBytes)
        const sized = Number.isFinite(bytes) && bytes > 0
        const mediaPlan: Array<{ kind: 'document' | 'audio'; build: () => Record<string, any> }> = []
        if (!sized || bytes <= WHATSAPP_MAX_DOCUMENT_BYTES) {
          mediaPlan.push({ kind: 'document', build: () => buildRecordingDocumentPayload({ to, recordingUrl, caption }) })
        }
        if (!sized || bytes <= WHATSAPP_MAX_AUDIO_BYTES) {
          mediaPlan.push({ kind: 'audio', build: () => buildRecordingAudioPayload({ to, recordingUrl }) })
        }

        for (const attempt of mediaPlan) {
          try {
            const res = await deps.post({ url: graphUrl, token, payload: attempt.build() })
            if (res.ok) {
              result.whatsapp = attempt.kind
              delivered = true
              log(`[CALL RECEIPT] WhatsApp ${attempt.kind} with recording sent for lead ${leadId} -> ${to}`)
              break
            }
            result.errors.push(`whatsapp ${attempt.kind} rejected: ${res.error || 'unknown'}`)
            log(`[CALL RECEIPT] WhatsApp ${attempt.kind} rejected (${res.error || 'unknown'}) - stepping down`)
          } catch (e: any) {
            result.errors.push(`whatsapp ${attempt.kind} threw: ${e?.message || e}`)
            log(`[CALL RECEIPT] WhatsApp ${attempt.kind} threw (${e?.message || e}) - stepping down`)
          }
        }

        if (result.whatsapp === 'skipped') {
          // Last resort: the alert as text, with the link. Losing the audio must
          // never lose the message.
          try {
            const res = await deps.post({
              url: graphUrl,
              token,
              payload: buildRecordingTextPayload({
                to,
                title: `🎙️ ${outcomeLabel(params.outcome)} — ${leadName}`,
                body: `${leadPhone}${summary ? `\n${summary.slice(0, 600)}` : ''}`,
                recordingUrl,
                crmUrl: params.crmUrl || null,
              }),
            })
            if (res.ok) {
              result.whatsapp = 'text'
              delivered = true
              log(`[CALL RECEIPT] WhatsApp text fallback with recording link sent for lead ${leadId} -> ${to}`)
            } else {
              result.whatsapp = 'failed'
              result.errors.push(`whatsapp text fallback rejected: ${res.error || 'unknown'}`)
            }
          } catch (e: any) {
            result.whatsapp = 'failed'
            result.errors.push(`whatsapp text fallback threw: ${e?.message || e}`)
          }
        }
      }
    }

    // ---- 4. Email with the playable link ----------------------------
    if (params.email === false) {
      // Caller embeds the link in its own alert email; nothing to do here.
    } else if (!deps.sendEmail) {
      log('[CALL RECEIPT] Email recording skipped - no mail transport provided')
    } else {
      const to = outboundEmail(params.emailTo)
      result.recipients = { ...(result.recipients || {}), email: to || undefined }
      if (!to) {
        log('[CALL RECEIPT] Email recording skipped - no recipient address')
      } else {
        try {
          const content = buildReceiptEmail({
            outcome: params.outcome,
            leadName,
            leadPhone,
            businessName: params.businessName,
            summary,
            recordingUrl,
            crmUrl: params.crmUrl || null,
            occurredAt: params.occurredAt || now,
            isTest,
          })
          const res = await deps.sendEmail({ to, ...content })
          if (res.success) {
            result.email = 'sent'
            delivered = true
            log(`[CALL RECEIPT] Recording email sent for lead ${leadId} -> ${to}`)
          } else {
            result.email = 'failed'
            result.errors.push(`email failed: ${res.error || 'unknown'}`)
          }
        } catch (e: any) {
          result.email = 'failed'
          result.errors.push(`email threw: ${e?.message || e}`)
          log(`[CALL RECEIPT] Email with recording failed for lead ${leadId}: ${e?.message || e}`)
        }
      }
    }

    if (!delivered) {
      // Nothing landed on any channel: hand the claim back so a webhook retry
      // can try again instead of being silently swallowed forever.
      try {
        await deps.store.releaseReceipt(leadId, receiptKey)
      } catch (e: any) {
        result.errors.push(`dedupe release failed: ${e?.message || e}`)
      }
      return { ...result, skipped: 'no_channel_delivered' }
    }

    return result
  } catch (e: any) {
    // Belt and braces: the caller's alert must survive anything in here.
    result.errors.push(`fatal: ${e?.message || e}`)
    log(`[CALL RECEIPT] Fatal error delivering recording: ${e?.message || e}`)
    return result
  }
}
