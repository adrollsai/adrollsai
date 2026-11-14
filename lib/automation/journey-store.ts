/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase rows and Meta payloads are untyped (stale generated types), matching utils/credits.ts. */
/**
 * The production side of the lead journey.
 *
 * `lib/automation/journey.ts` is the engine and knows nothing about Supabase or
 * Meta. This file supplies the three things it injects — a store, a sender and an
 * owner notice — and exposes the two entry points the rest of the app uses:
 *
 *   onInboundLeadEvent()   — called by the WhatsApp webhook for every inbound
 *                            lead message: reads opt-out / handoff out of it and
 *                            starts the journey for a lead that has none.
 *   sendDueJourneySteps()  — called by the EXISTING whatsapp-followup cron
 *                            (every 15 minutes). No second queue, no second cron.
 *
 * THE JOURNEY IS OPT-IN
 * `cadence.journey.enabled` in the tenant's playbook gates every single write in
 * this file. Until an owner turns it on, a live lead sees byte-identical
 * behaviour to before this module existed.
 */

import { getActivePlaybook, type Playbook } from '@/lib/automation/ceo'
import { outboundRecipient } from '@/lib/automation/test-mode'
import {
  applyInboundIntent,
  journeyFromPlaybook,
  processDueSteps,
  startJourney,
  type JourneyDeps,
  type JourneyLogEntry,
  type JourneySender,
  type JourneyStepRow,
  type JourneyStore,
  type LeadJourney,
  type LeadJourneyState,
  type LeadIntentKind,
  type OutboundLeadMessage,
  type ProcessResult,
  type SendResult,
} from '@/lib/automation/journey'

export const JOURNEY_TABLE = 'lead_journey_steps'

/** Postgres unique-violation — the (lead_id, step_id) idempotency hit. */
const UNIQUE_VIOLATION = '23505'

function isMissingTable(message?: string): boolean {
  return /does not exist|schema cache|Could not find the table/i.test(String(message || ''))
}

function parseFields(raw: unknown): Record<string, any> {
  if (!raw) return {}
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  return typeof raw === 'object' ? { ...(raw as Record<string, any>) } : {}
}

function rowFromDb(row: any): JourneyStepRow {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    leadId: String(row.lead_id),
    campaignId: row.campaign_id ?? null,
    stepId: row.step_id,
    kind: row.kind,
    status: row.status,
    dueAt: row.due_at,
    body: row.body || '',
    template: row.template ?? null,
    intent: row.intent || '',
    attempts: Number(row.attempts || 0),
    sentAt: row.sent_at ?? null,
    cancelledAt: row.cancelled_at ?? null,
    cancelReason: row.cancel_reason ?? null,
    blockedReason: row.blocked_reason ?? null,
  }
}

/** Merge keys into `leads.custom_fields` without clobbering anything else. */
async function mergeLeadFields(
  supabase: any,
  leadId: string,
  patch: Record<string, any>
): Promise<Record<string, any>> {
  const { data } = await supabase
    .from('leads')
    .select('custom_fields')
    .eq('id', leadId)
    .maybeSingle()
  const merged = { ...parseFields(data?.custom_fields), ...patch }
  await supabase.from('leads').update({ custom_fields: merged }).eq('id', leadId)
  return merged
}

async function remark(supabase: any, leadId: string, description: string): Promise<void> {
  try {
    await supabase.from('lead_history').insert({
      lead_id: leadId,
      action_type: 'REMARK',
      description,
      created_at: new Date().toISOString(),
    })
  } catch (e: any) {
    console.warn('[Journey] lead_history write skipped:', e?.message || e)
  }
}

/* ------------------------------------------------------------------ */
/* Store                                                              */
/* ------------------------------------------------------------------ */

export function createSupabaseJourneyStore(supabase: any): JourneyStore {
  return {
    async enqueue(input) {
      const { data, error } = await supabase
        .from(JOURNEY_TABLE)
        .insert({
          user_id: input.userId,
          lead_id: input.leadId,
          campaign_id: input.campaignId ?? null,
          step_id: input.stepId,
          kind: input.kind,
          status: 'pending',
          due_at: input.dueAt,
          body: input.body,
          template: input.template ?? null,
          intent: input.intent,
          attempts: 0,
        })
        .select('*')
        .single()

      if (!error && data) return { row: rowFromDb(data), created: true }

      if (error?.code === UNIQUE_VIOLATION) {
        // Another delivery (or worker) already planned this (lead, step). Read it
        // back so the caller can carry on without sending anything twice.
        const { data: existing } = await supabase
          .from(JOURNEY_TABLE)
          .select('*')
          .eq('lead_id', input.leadId)
          .eq('step_id', input.stepId)
          .maybeSingle()
        if (existing) return { row: rowFromDb(existing), created: false }
      }

      if (isMissingTable(error?.message)) {
        // Migration not applied yet: refuse to pretend a step exists.
        console.warn(`[Journey] ${JOURNEY_TABLE} is missing — apply sql/migrations/19_lead_journey.sql`)
        throw new Error(`${JOURNEY_TABLE} is missing (migration not applied)`)
      }

      throw new Error(`could not enqueue journey step: ${error?.message || 'unknown error'}`)
    },

    async due(now, opts = {}) {
      let query = supabase
        .from(JOURNEY_TABLE)
        .select('*')
        .eq('status', 'pending')
        .lte('due_at', now.toISOString())
        .order('due_at', { ascending: true })
        .limit(opts.limit ?? 50)
      if (opts.leadId) query = query.eq('lead_id', opts.leadId)

      const { data, error } = await query
      if (error) {
        if (isMissingTable(error.message)) return []
        throw new Error(`could not read due journey steps: ${error.message}`)
      }
      return (data || []).map(rowFromDb)
    },

    async claim(id, now) {
      // Compare-and-set on `status`: only the caller that flips pending -> sending
      // owns this step. A retried cron therefore cannot double-send.
      const { data, error } = await supabase
        .from(JOURNEY_TABLE)
        .update({ status: 'sending', updated_at: now.toISOString() })
        .eq('id', id)
        .eq('status', 'pending')
        .select('*')
        .maybeSingle()
      if (error || !data) return null
      return rowFromDb(data)
    },

    async markSent(id, at) {
      await supabase
        .from(JOURNEY_TABLE)
        .update({ status: 'sent', sent_at: at.toISOString(), updated_at: at.toISOString() })
        .eq('id', id)
    },

    async markCancelled(id, reason, at) {
      await supabase
        .from(JOURNEY_TABLE)
        .update({
          status: 'cancelled',
          cancelled_at: at.toISOString(),
          cancel_reason: reason,
          updated_at: at.toISOString(),
        })
        .eq('id', id)
    },

    async markBlocked(id, reason, at) {
      await supabase
        .from(JOURNEY_TABLE)
        .update({
          status: 'blocked',
          blocked_reason: reason,
          updated_at: at.toISOString(),
        })
        .eq('id', id)
    },

    async cancelPendingForLead(leadId, reason, at) {
      const { data } = await supabase
        .from(JOURNEY_TABLE)
        .update({
          status: 'cancelled',
          cancelled_at: at.toISOString(),
          cancel_reason: reason,
          updated_at: at.toISOString(),
        })
        .eq('lead_id', leadId)
        .eq('status', 'pending')
        .select('id')
      return Array.isArray(data) ? data.length : 0
    },

    async leadState(leadId): Promise<LeadJourneyState> {
      const { data } = await supabase
        .from('leads')
        .select('custom_fields, whatsapp_window_expires_at')
        .eq('id', leadId)
        .maybeSingle()
      const cf = parseFields(data?.custom_fields)
      const optedOut = cf.journey_opt_out_at
        || cf.unsubscribed_at
        || (cf.opt_out === true ? new Date(0).toISOString() : null)
      return {
        optedOutAt: optedOut ? String(optedOut) : null,
        handoffAt: cf.journey_handoff_at ? String(cf.journey_handoff_at) : null,
        windowExpiresAt: data?.whatsapp_window_expires_at ?? null,
      }
    },

    async recordOptOut(leadId, at, matched) {
      await mergeLeadFields(supabase, leadId, {
        opt_out: true,
        unsubscribed_at: at.toISOString(),
        journey_opt_out_at: at.toISOString(),
        journey_opt_out_word: matched || null,
      })
      await remark(supabase, leadId, `🛑 Opt-out read from WhatsApp ("${matched || 'button'}") — every pending journey step cancelled.`)
    },

    async recordHandoff(leadId, at, reason) {
      await mergeLeadFields(supabase, leadId, {
        journey_handoff_at: at.toISOString(),
        journey_handoff_reason: reason || null,
        needs_human: true,
      })
      await remark(supabase, leadId, `🙋 Lead asked for a human ("${reason || 'request'}") — automated messaging stopped, owner notified.`)
    },

    async log(entry: JourneyLogEntry) {
      const icon =
        entry.event === 'blocked' ? '🚫'
        : entry.event === 'sent' ? '📨'
        : entry.event === 'opt_out' ? '🛑'
        : entry.event === 'handoff' ? '🙋'
        : entry.event === 'started' ? '🧭'
        : '⏭️'
      console.log(`[Journey] ${entry.event} lead=${entry.leadId} step=${entry.stepId || '-'} — ${entry.detail}`)
      await remark(supabase, entry.leadId, `${icon} JOURNEY ${entry.event.toUpperCase()}: ${entry.detail}`)
    },
  }
}

/* ------------------------------------------------------------------ */
/* Sender                                                             */
/* ------------------------------------------------------------------ */

const GRAPH_VERSION = 'v20.0'

function waCredsCache(supabase: any) {
  const cache = new Map<string, { token: string; phoneId: string } | null>()
  return async (userId: string) => {
    if (cache.has(userId)) return cache.get(userId)!
    const { data } = await supabase
      .from('profiles')
      .select('whatsapp_access_token, whatsapp_phone_number_id')
      .eq('id', userId)
      .maybeSingle()
    // The tenant's OWN credentials only. Nobogent's number is never used for
    // someone else's lead — that was a real bug in the weekly follow-up cron.
    const creds = data?.whatsapp_access_token && data?.whatsapp_phone_number_id
      ? { token: String(data.whatsapp_access_token), phoneId: String(data.whatsapp_phone_number_id) }
      : null
    cache.set(userId, creds)
    return creds
  }
}

export function createWhatsAppJourneySender(supabase: any): JourneySender {
  const credsFor = waCredsCache(supabase)

  return {
    async send(message: OutboundLeadMessage): Promise<SendResult> {
      const to = String(message.to || '').replace(/\D/g, '')
      if (to.length < 10) {
        return { ok: false, channel: 'whatsapp', error: 'no dialable recipient after the test-mode redirect' }
      }

      const creds = await credsFor(message.userId)
      if (!creds) {
        return { ok: false, channel: 'whatsapp', error: 'the tenant has not connected a WhatsApp Business number' }
      }

      const buttons = message.buttons.slice(0, 3).map((b) => ({
        type: 'reply',
        reply: { id: b.id, title: String(b.label || b.id).slice(0, 20) },
      }))

      const payload: any = message.windowOpen
        ? {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'interactive',
            interactive: { type: 'button', body: { text: message.body }, action: { buttons } },
          }
        : {
            // Outside the 24h service window only an approved template may be
            // sent. Static copy, with the same three quick-reply payload ids so
            // the buttons behave identically to the free-form version.
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'template',
            template: {
              name: message.template || 'lead_journey_first_reply',
              language: { code: 'en_US' },
              components: [
                {
                  type: 'button',
                  sub_type: 'quick_reply',
                  index: '0',
                  parameters: [{ type: 'payload', payload: 'view_properties' }],
                },
                {
                  type: 'button',
                  sub_type: 'quick_reply',
                  index: '1',
                  parameters: [{ type: 'payload', payload: 'talk_expert' }],
                },
                {
                  type: 'button',
                  sub_type: 'quick_reply',
                  index: '2',
                  parameters: [{ type: 'payload', payload: 'book_appointment' }],
                },
              ],
            },
          }

      try {
        const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${creds.phoneId}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const json: any = await res.json().catch(() => ({}))
        if (!res.ok || json?.error) {
          return {
            ok: false,
            channel: 'whatsapp',
            error: json?.error?.message || `Meta responded ${res.status}`,
          }
        }
        return { ok: true, channel: 'whatsapp' }
      } catch (e: any) {
        return { ok: false, channel: 'whatsapp', error: String(e?.message || e) }
      }
    },
  }
}

/* ------------------------------------------------------------------ */
/* Context: journey + everything a message needs                       */
/* ------------------------------------------------------------------ */

export interface JourneyContext {
  playbook: Playbook | null
  journey: LeadJourney
  industry: string | null
  businessName: string | null
}

/** The active journey for a tenant, read from the playbook (never invented). */
export async function resolveJourneyContext(
  supabase: any,
  userId: string,
  opts: { campaignId?: string | null } = {}
): Promise<JourneyContext> {
  const [{ data: profile }, playbook] = await Promise.all([
    supabase.from('profiles').select('id, business_name, industry').eq('id', userId).maybeSingle(),
    getActivePlaybook(supabase, userId),
  ])

  return {
    playbook,
    journey: journeyFromPlaybook(playbook, {
      industry: profile?.industry ?? null,
      campaignId: opts.campaignId ?? null,
    }),
    industry: profile?.industry ?? null,
    businessName: profile?.business_name ?? null,
  }
}

function ownerNotifier(supabase: any) {
  return async (notice: { userId: string; leadId: string; title: string; body: string }) => {
    try {
      const { sendPushNotification } = await import('@/utils/notification-helper')
      await sendPushNotification(notice.userId, notice.title, notice.body, `/dashboard/crm/${notice.leadId}`)
    } catch (e: any) {
      console.warn('[Journey] owner notification not delivered:', e?.message || e)
    }
    await remark(supabase, notice.leadId, `🔔 ${notice.title} — ${notice.body}`)
  }
}

/* ------------------------------------------------------------------ */
/* Entry point 1: an inbound lead message (the webhook)               */
/* ------------------------------------------------------------------ */

export interface InboundLeadEventInput {
  leadId: string
  userId: string
  campaignId?: string | null
  text?: string | null
  buttonId?: string | null
  leadName?: string | null
  phone?: string | null
  now?: Date
}

export interface InboundLeadEventResult {
  /** False when the tenant has not turned the journey on — nothing was written. */
  enabled: boolean
  kind: LeadIntentKind
  cancelled: number
  notifiedOwner: boolean
  /**
   * True when the journey has already replied to this message, so the webhook's
   * own flow/bot replies must stand down to avoid two replies to one lead.
   */
  ownsMessaging: boolean
  stepsPlanned: number
  sentNow: number
}

/**
 * Read one inbound lead message against the journey.
 *
 * Called for EVERY inbound lead message, so it is written to be boring when the
 * journey is off (one profile + playbook read, nothing else) and to fail closed
 * when anything throws: the webhook's legacy handling must not be broken by it.
 */
export async function onInboundLeadEvent(
  supabase: any,
  input: InboundLeadEventInput
): Promise<InboundLeadEventResult> {
  const empty: InboundLeadEventResult = {
    enabled: false,
    kind: 'neutral',
    cancelled: 0,
    notifiedOwner: false,
    ownsMessaging: false,
    stepsPlanned: 0,
    sentNow: 0,
  }

  const now = input.now ?? new Date()
  const ctx = await resolveJourneyContext(supabase, input.userId, { campaignId: input.campaignId })
  if (!ctx.journey.enabled) return empty

  const store = createSupabaseJourneyStore(supabase)
  const notify = ownerNotifier(supabase)
  const deps: JourneyDeps = {
    store,
    sender: createWhatsAppJourneySender(supabase),
    now: () => now,
    notifyOwner: async (notice) => {
      // The webhook already raises its own "Talk to an expert" alert for the
      // expert button; notifying again here would ring the owner twice for one
      // tap. Any other handoff phrase is ours to escalate.
      const viaExpertButton =
        String(input.buttonId || '') === 'talk_expert' || String(input.buttonId || '') === 'connect_expert'
      if (viaExpertButton) {
        await remark(supabase, notice.leadId, '🙋 Handoff recorded from the "Talk to expert" button (the webhook has already alerted the owner).')
        return
      }
      await notify(notice)
    },
  }

  // 1. Opt-out / handoff first: they must act even if the journey never started.
  const intent = await applyInboundIntent(deps, {
    journey: ctx.journey,
    leadId: input.leadId,
    userId: input.userId,
    text: input.text,
    buttonId: input.buttonId,
  })

  if (intent.kind !== 'neutral') {
    return {
      enabled: true,
      kind: intent.kind,
      cancelled: intent.cancelled,
      notifiedOwner: intent.notifiedOwner,
      // The webhook keeps its own acknowledgement for both cases; the journey
      // only takes over when it has actually replied.
      ownsMessaging: false,
      stepsPlanned: 0,
      sentNow: 0,
    }
  }

  // 2. Otherwise start the journey if this lead does not have one yet.
  const started = await startJourney(deps, {
    journey: ctx.journey,
    leadId: input.leadId,
    userId: input.userId,
    campaignId: input.campaignId ?? null,
    startedAt: now,
  })

  if (!started.created) {
    return { ...empty, enabled: true, stepsPlanned: started.steps.length }
  }

  // Mark the lead as journey-owned, so the weekly re-engagement drip in
  // /api/cron/whatsapp-followup leaves it alone: one lead, one automated
  // schedule, however many crons exist.
  await mergeLeadFields(supabase, input.leadId, {
    journey_started_at: now.toISOString(),
    journey_campaign_id: input.campaignId ?? null,
  })

  // 3. The first reply is T+0, so send it now rather than waiting for the cron:
  //    the lead asked a question and expects an answer in seconds.
  const sent = await processDueSteps(deps, {
    leadId: input.leadId,
    journey: ctx.journey,
    contextFor: async () => ({
      playbook: ctx.playbook,
      industry: ctx.industry,
      businessName: ctx.businessName,
      leadName: input.leadName ?? null,
      phone: input.phone ?? null,
      journey: ctx.journey,
    }),
  })

  return {
    enabled: true,
    kind: 'neutral',
    cancelled: 0,
    notifiedOwner: false,
    ownsMessaging: sent.sent > 0,
    stepsPlanned: started.steps.length,
    sentNow: sent.sent,
  }
}

/* ------------------------------------------------------------------ */
/* Entry point 2: due steps (the existing whatsapp-followup cron)     */
/* ------------------------------------------------------------------ */

export interface SendDueOptions {
  now?: Date
  limit?: number
  leadId?: string
}

/**
 * Send every journey step that has come due. Idempotent: each step is claimed
 * once, so a cron that fires twice in a minute still sends once.
 */
export async function sendDueJourneySteps(
  supabase: any,
  opts: SendDueOptions = {}
): Promise<ProcessResult> {
  const now = opts.now ?? new Date()
  const store = createSupabaseJourneyStore(supabase)
  const contexts = new Map<string, JourneyContext>()

  const contextFor = async (row: JourneyStepRow) => {
    let ctx = contexts.get(row.userId)
    if (!ctx) {
      ctx = await resolveJourneyContext(supabase, row.userId, { campaignId: row.campaignId })
      contexts.set(row.userId, ctx)
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('id, name, phone')
      .eq('id', row.leadId)
      .maybeSingle()

    return {
      playbook: ctx.playbook,
      industry: ctx.industry,
      businessName: ctx.businessName,
      leadName: lead?.name ?? null,
      phone: outboundRecipient(lead?.phone) || null,
    }
  }

  return processDueSteps(
    {
      store,
      sender: createWhatsAppJourneySender(supabase),
      now: () => now,
      notifyOwner: ownerNotifier(supabase),
    },
    { leadId: opts.leadId, limit: opts.limit, contextFor }
  )
}

/**
 * Cancel every pending step for a lead, from anywhere (e.g. an owner marking the
 * lead Lost in the dashboard). Idempotent and safe to call for unknown leads.
 */
export async function cancelJourneyForLead(
  supabase: any,
  leadId: string,
  reason: string,
  now: Date = new Date()
): Promise<number> {
  const store = createSupabaseJourneyStore(supabase)
  const cancelled = await store.cancelPendingForLead(leadId, reason, now)
  if (cancelled > 0) {
    await store.log({
      leadId,
      event: 'cancelled',
      detail: `${cancelled} pending step(s) cancelled: ${reason}`,
      at: now.toISOString(),
    })
  }
  return cancelled
}
