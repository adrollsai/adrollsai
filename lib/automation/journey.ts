/* eslint-disable @typescript-eslint/no-explicit-any -- catch clauses and the injected store/sender boundaries are deliberately untyped, matching lib/automation/test-mode.ts. */
/**
 * The per-campaign lead journey: first reply, T+1h, T+1d.
 *
 * WHAT THIS IS
 * A journey is DATA, not branches. One `LeadJourney` says what we say first,
 * what we say an hour later and a day later, when we stop (opt-out) and when a
 * human takes over (handoff). It is stored in the tenant's playbook under
 * `cadence.journey`, so the owner edits it by describing it in chat and the CEO
 * writes it through `applyPlaybookPatch()` — this module never touches the
 * playbook table itself.
 *
 * WHY IT IS PURE AND INJECTED
 * Timing bugs are invisible until a customer complains. So the engine takes an
 * injected clock, an injected store and an injected sender: `planJourney()`,
 * `startJourney()`, `processDueSteps()` and `applyInboundIntent()` are all
 * exercised offline in `scripts/verify-journey.ts` with no network and no
 * database. The Supabase/WhatsApp side lives in `journey-store.ts`.
 *
 * THE THREE HARD RULES, ENFORCED HERE
 *  1. Idempotent per `(lead, step)`: a webhook Meta retries ten times still
 *     produces ONE first reply. Enqueue is a unique-key insert; send is a
 *     compare-and-set claim from `pending`.
 *  2. Opt-out is instant and permanent: it cancels every pending step now AND is
 *     re-read on every send attempt, so a step queued before the opt-out still
 *     does not fire.
 *  3. Every message carries the three reply buttons with their stable ids
 *     (`view_properties | talk_expert | book_appointment`) and passes
 *     `checkLeadMessagePolicy()`. A violation is blocked AND logged with its
 *     reason — never silently dropped.
 */

import { resolveReplyButtons, type Playbook, type ReplyButton } from '@/lib/automation/ceo'
import { industryVocabulary } from '@/lib/automation/industry'
import { outboundRecipient, isOutboundTestMode } from '@/lib/automation/test-mode'
import { checkLeadMessagePolicy, type PolicyVerdict } from '@/lib/automation/lead-message-policy'

/* ------------------------------------------------------------------ */
/* 1. The journey shape                                               */
/* ------------------------------------------------------------------ */

export type JourneyStepId = 'first_reply' | 'followup_1h' | 'followup_1d'
export type JourneyStepKind = 'first_reply' | 'followup'

export interface JourneyStep {
  id: JourneyStepId
  kind: JourneyStepKind
  /** Minutes after the journey started, i.e. after the inbound lead event. */
  offsetMinutes: number
  /** What this step is FOR, in plain language, so the playbook can be authored from a sentence. */
  intent: string
  /** Approved Meta template, used when the 24h service window is shut. */
  template: string | null
  /** Copy with {{name}} / {{business}} / {{product}} / {{products}} placeholders. */
  body: string
}

export interface JourneyOptOutRule {
  /** Any of these (or the not_interested button) cancels everything, immediately. */
  words: string[]
  /** One short confirmation. Never a sales pitch. */
  ackBody: string
  rule: string
}

export interface JourneyHandoffRule {
  /** Phrases that mean "a person, please". */
  triggers: string[]
  /** Button ids that mean the same thing. */
  buttonIds: string[]
  rule: string
  noticeTitle: string
  noticeBody: string
}

export interface LeadJourney {
  version: number
  /**
   * Off by default. A tenant opts IN through the playbook (`cadence.journey`),
   * so shipping this module cannot change what a live lead receives until the
   * owner (or the CEO, with their sentence) turns it on.
   */
  enabled: boolean
  campaignId: string | null
  firstReply: JourneyStep
  /** T+1h then T+1d, in due order. */
  followups: JourneyStep[]
  optOut: JourneyOptOutRule
  handoff: JourneyHandoffRule
}

/** Shipped defaults. Industry-neutral: no assumption of property sales anywhere. */
export function defaultJourney(industry?: string | null): LeadJourney {
  const vocab = industryVocabulary(industry)
  const products = vocab.productNounPlural

  return {
    version: 1,
    enabled: false,
    campaignId: null,
    firstReply: {
      id: 'first_reply',
      kind: 'first_reply',
      offsetMinutes: 0,
      intent: `answer the enquiry, say who we are, and offer the three next steps for our ${products}`,
      template: 'lead_journey_first_reply',
      body:
        `Hi {{name}}, thanks for reaching out to {{business}}. ` +
        `Happy to help with our ${products} — what would you like to do next?`,
    },
    followups: [
      {
        id: 'followup_1h',
        kind: 'followup',
        offsetMinutes: 60,
        intent: `one hour later: add one genuinely useful sentence and invite a question, no pressure`,
        template: 'lead_journey_followup_1h',
        body:
          `Hi {{name}}, {{business}} here again. ` +
          `If it helps, I can send more detail on any of our ${products} — just reply with what you need.`,
      },
      {
        id: 'followup_1d',
        kind: 'followup',
        offsetMinutes: 1440,
        intent: `a day later: last check-in of the journey, and tell them plainly how to stop hearing from us`,
        template: 'lead_journey_followup_1d',
        body:
          `Hi {{name}}, last check-in from {{business}}. ` +
          `If now is not the right time, reply STOP and we will not message you again.`,
      },
    ],
    optOut: {
      words: [
        'stop',
        'stop it',
        'stop messaging',
        'unsubscribe',
        'not interested',
        'no thanks',
        'no thank you',
        'cancel',
        'remove me',
        'do not message',
        "don't message",
        'dont message',
        'nahi',
        'nahin',
        'mat bhejo',
        'band karo',
        'mujhe interest nahi',
      ],
      ackBody:
        'Understood — we have stopped all automated messages. Reply here any time if you need us.',
      rule: 'an opt-out cancels every pending step immediately and is honoured on every later send attempt',
    },
    handoff: {
      triggers: [
        'human',
        'real person',
        'someone real',
        'speak to someone',
        'talk to someone',
        'talk to a person',
        'expert',
        'specialist',
        'representative',
        'agent',
        'call me',
        'phone me',
        'manager',
        'insaan',
        'kisi se baat',
      ],
      buttonIds: ['talk_expert', 'connect_expert'],
      rule: 'stop automated messaging, mark the lead for a human and tell the owner once',
      noticeTitle: 'Lead asked for a human',
      noticeBody: 'Automated messages for this lead are paused. A person needs to reply.',
    },
  }
}

/* ------------------------------------------------------------------ */
/* 2. Reading and patching the journey through the playbook           */
/* ------------------------------------------------------------------ */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function uniqueStrings(base: string[], add: unknown): string[] {
  if (!Array.isArray(add)) return base
  const extra = add
    .map((w) => String(w || '').trim().toLowerCase())
    .filter((w) => w.length > 0)
  // Union, never subtraction: an owner may ADD opt-out words but the shipped
  // ones keep working, because a silent "STOP" regression is unrecoverable.
  return Array.from(new Set([...base.map((w) => w.toLowerCase()), ...extra]))
}

/**
 * Overlay one authored journey (a playbook patch, or a per-campaign override)
 * onto a base journey. Every field is optional, so a partial patch can only ever
 * ADD to what ships.
 */
function applyJourneyPatch(base: LeadJourney, patch: unknown): LeadJourney {
  if (!isPlainObject(patch)) return base
  const next: LeadJourney = {
    ...base,
    version: Number(patch.version) || base.version,
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : base.enabled,
    campaignId:
      typeof patch.campaignId === 'string' && patch.campaignId.trim()
        ? patch.campaignId.trim()
        : base.campaignId,
  }

  if (isPlainObject(patch.firstReply)) {
    next.firstReply = {
      ...base.firstReply,
      ...(patch.firstReply as Partial<JourneyStep>),
      id: 'first_reply',
      kind: 'first_reply',
    }
  }

  if (Array.isArray(patch.followups)) {
    const authoredSteps = patch.followups.filter(isPlainObject) as Array<Partial<JourneyStep> & { id?: string }>
    next.followups = base.followups.map((step) => {
      const match = authoredSteps.find((s) => String(s?.id || '') === step.id)
      return match ? { ...step, ...match, id: step.id, kind: 'followup' } : step
    })
  }

  if (isPlainObject(patch.optOut)) {
    const p = patch.optOut as Record<string, unknown>
    next.optOut = {
      ...base.optOut,
      words: uniqueStrings(base.optOut.words, p.words),
      ackBody: typeof p.ackBody === 'string' && p.ackBody.trim() ? p.ackBody : base.optOut.ackBody,
      rule: typeof p.rule === 'string' && p.rule.trim() ? p.rule : base.optOut.rule,
    }
  }

  if (isPlainObject(patch.handoff)) {
    const p = patch.handoff as Record<string, unknown>
    next.handoff = {
      ...base.handoff,
      triggers: uniqueStrings(base.handoff.triggers, p.triggers),
      buttonIds: uniqueStrings(base.handoff.buttonIds, p.buttonIds),
      rule: typeof p.rule === 'string' && p.rule.trim() ? p.rule : base.handoff.rule,
      noticeTitle: typeof p.noticeTitle === 'string' && p.noticeTitle.trim() ? p.noticeTitle : base.handoff.noticeTitle,
      noticeBody: typeof p.noticeBody === 'string' && p.noticeBody.trim() ? p.noticeBody : base.handoff.noticeBody,
    }
  }

  return next
}

/**
 * The active journey for a tenant, and for one campaign when a campaign override
 * exists.
 *
 * Stored as data inside the playbook's `cadence` section:
 *
 *   cadence.journey = {
 *     enabled: true,
 *     firstReply: { intent, template, body },
 *     followups:  [ { id: 'followup_1h', offsetMinutes: 60 }, { id: 'followup_1d', offsetMinutes: 1440 } ],
 *     optOut:     { words: [...], ackBody, rule },
 *     handoff:    { triggers: [...], buttonIds: [...], rule },
 *     campaigns:  { '<campaign id>': { enabled, followups: [...] } }   // per-campaign override
 *   }
 *
 * Anything the playbook does not name keeps the shipped default, so a partial
 * patch is always safe.
 */
export function journeyFromPlaybook(
  playbook: Partial<Playbook> | null | undefined,
  opts: { industry?: string | null; campaignId?: string | null } = {}
): LeadJourney {
  const industry = playbook?.industry ?? opts.industry ?? null
  const base = defaultJourney(industry)
  const authored = isPlainObject(playbook?.cadence)
    ? (playbook!.cadence as Record<string, unknown>).journey
    : undefined

  if (!isPlainObject(authored)) {
    return { ...base, campaignId: opts.campaignId ?? base.campaignId }
  }

  // 1. The tenant's own journey.
  let next = applyJourneyPatch({ ...base, campaignId: opts.campaignId ?? base.campaignId }, authored)

  // 2. A campaign override, when this lead came from that campaign. More
  //    specific wins, but it still cannot switch the journey on for a tenant
  //    that has it off — the tenant-level flag is the master switch.
  const campaigns = isPlainObject((authored as Record<string, unknown>).campaigns)
    ? ((authored as Record<string, unknown>).campaigns as Record<string, unknown>)
    : null
  const key = opts.campaignId || next.campaignId
  const override = campaigns && key ? campaigns[String(key)] : null
  if (isPlainObject(override)) {
    const merged = applyJourneyPatch({ ...next, campaignId: String(key) }, override)
    next = { ...merged, enabled: next.enabled }
  }

  return next
}

/**
 * A playbook patch that changes exactly the journey. Hand this to
 * `applyPlaybookPatch(auth, userId, journeyPatch(journey))` — the journey lives
 * inside the patchable `cadence` section, so no new table and no direct write.
 */
export function journeyPatch(journey: LeadJourney): { section: 'cadence'; value: { journey: unknown } } {
  return {
    section: 'cadence',
    value: {
      journey: {
        version: journey.version,
        enabled: journey.enabled,
        campaignId: journey.campaignId,
        firstReply: journey.firstReply,
        followups: journey.followups,
        optOut: journey.optOut,
        handoff: journey.handoff,
      },
    },
  }
}

/** Every step of the journey in due order. */
export function journeySteps(journey: LeadJourney): JourneyStep[] {
  return [journey.firstReply, ...journey.followups].slice().sort((a, b) => a.offsetMinutes - b.offsetMinutes)
}

/* ------------------------------------------------------------------ */
/* 3. Reading an inbound reply                                        */
/* ------------------------------------------------------------------ */

export type LeadIntentKind = 'opt_out' | 'handoff' | 'neutral'

export interface LeadIntent {
  kind: LeadIntentKind
  /** The word/phrase or button id that decided it — logged with the cancellation. */
  matched: string | null
}

function normaliseReply(text?: string | null): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Word-boundary test that also works for Indic words and multi-word phrases. */
function containsPhrase(normalised: string, phrase: string): boolean {
  const p = normaliseReply(phrase)
  if (!p) return false
  if (normalised === p) return true
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|\\s)${escaped}($|\\s)`).test(normalised)
}

/**
 * Classify one inbound lead message.
 *
 * ONE classifier for the whole product: the webhook, the cron and the engine all
 * call this, so "stop / unsubscribe / not interested / nahi" cannot drift into
 * two different opinions about the same word.
 *
 * Opt-out wins over handoff: if a lead says "stop, I want a human", they get
 * silence, which is the safer of the two readings.
 */
export function classifyLeadReply(input: {
  text?: string | null
  buttonId?: string | null
  journey?: LeadJourney
}): LeadIntent {
  const journey = input.journey ?? defaultJourney()
  const buttonId = String(input.buttonId || '').trim().toLowerCase()
  const normalised = normaliseReply(input.text)

  if (buttonId === 'not_interested' || buttonId === 'unsubscribe' || buttonId === 'opt_out') {
    return { kind: 'opt_out', matched: buttonId }
  }
  for (const word of journey.optOut.words) {
    if (containsPhrase(normalised, word)) return { kind: 'opt_out', matched: word }
  }

  if (journey.handoff.buttonIds.some((id) => String(id).toLowerCase() === buttonId)) {
    return { kind: 'handoff', matched: buttonId }
  }
  for (const trigger of journey.handoff.triggers) {
    if (containsPhrase(normalised, trigger)) return { kind: 'handoff', matched: trigger }
  }

  return { kind: 'neutral', matched: null }
}

/* ------------------------------------------------------------------ */
/* 4. Planning: when does each step become due?                       */
/* ------------------------------------------------------------------ */

export interface PlannedStep {
  stepId: JourneyStepId
  kind: JourneyStepKind
  offsetMinutes: number
  dueAt: Date
  body: string
  template: string | null
  intent: string
}

/**
 * The whole journey, expressed as absolute instants. T+0 is the first reply,
 * T+1h and T+1d follow — computed from the inbound lead event, never from "the
 * last send", so a missed cron tick cannot slide the schedule.
 */
export function planJourney(journey: LeadJourney, startedAt: Date): PlannedStep[] {
  if (!Number.isFinite(startedAt.getTime())) {
    throw new Error('planJourney: startedAt is not a valid date')
  }
  return journeySteps(journey).map((step) => ({
    stepId: step.id,
    kind: step.kind,
    offsetMinutes: step.offsetMinutes,
    dueAt: new Date(startedAt.getTime() + step.offsetMinutes * 60_000),
    body: step.body,
    template: step.template ?? null,
    intent: step.intent,
  }))
}

/* ------------------------------------------------------------------ */
/* 5. The store and sender contracts (injected, so tests are offline)  */
/* ------------------------------------------------------------------ */

export type JourneyStepStatus = 'pending' | 'sending' | 'sent' | 'cancelled' | 'blocked'

export interface JourneyStepRow {
  id: string
  userId: string
  leadId: string
  campaignId: string | null
  stepId: JourneyStepId
  kind: JourneyStepKind
  status: JourneyStepStatus
  dueAt: string
  body: string
  template: string | null
  intent: string
  attempts: number
  sentAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  blockedReason: string | null
}

export interface LeadJourneyState {
  /** Set the moment an opt-out is read. Irreversible. */
  optedOutAt: string | null
  /** Set the moment a human handoff is read. */
  handoffAt: string | null
  /** When the 24h WhatsApp service window closes for this lead, if known. */
  windowExpiresAt: string | null
}

export interface EnqueueInput extends Omit<JourneyStepRow, 'id' | 'status' | 'attempts' | 'sentAt' | 'cancelledAt' | 'cancelReason' | 'blockedReason'> {
  /** Stable key for the row: `${leadId}:${stepId}` in the database. */
  key?: string
}

export interface EnqueueResult {
  row: JourneyStepRow
  /** false when this (lead, step) already existed — the idempotency hit. */
  created: boolean
}

export interface JourneyStore {
  /** Insert-or-ignore on (lead_id, step_id). The unique key is the idempotency guard. */
  enqueue(input: EnqueueInput): Promise<EnqueueResult>
  /** Pending rows whose due time has passed, oldest first. */
  due(now: Date, opts?: { leadId?: string; limit?: number }): Promise<JourneyStepRow[]>
  /** Atomic pending -> sending. Returns null when someone else already has it. */
  claim(id: string, now: Date): Promise<JourneyStepRow | null>
  markSent(id: string, at: Date): Promise<void>
  markCancelled(id: string, reason: string, at: Date): Promise<void>
  markBlocked(id: string, reason: string, at: Date): Promise<void>
  /** Cancel every pending step for a lead. Returns how many were stopped. */
  cancelPendingForLead(leadId: string, reason: string, at: Date): Promise<number>
  leadState(leadId: string): Promise<LeadJourneyState>
  recordOptOut(leadId: string, at: Date, matched: string | null): Promise<void>
  recordHandoff(leadId: string, at: Date, reason: string | null): Promise<void>
  /** Append-only audit line. A blocked send MUST end up here. */
  log(entry: JourneyLogEntry): Promise<void>
}

export interface JourneyLogEntry {
  leadId: string
  stepId?: JourneyStepId | null
  event: 'started' | 'sent' | 'blocked' | 'cancelled' | 'opt_out' | 'handoff' | 'skipped'
  detail: string
  at: string
}

/** What a channel adapter receives. Already test-mode redirected and policy checked. */
export interface OutboundLeadMessage {
  to: string
  body: string
  buttons: ReplyButton[]
  template: string | null
  windowOpen: boolean
  userId: string
  leadId: string
  stepId: JourneyStepId
  intent: string
  businessName: string
}

export interface SendResult {
  ok: boolean
  channel: string
  /** Present when ok is false. */
  error?: string
}

export interface JourneySender {
  send(message: OutboundLeadMessage): Promise<SendResult>
}

export interface OwnerNotice {
  userId: string
  leadId: string
  title: string
  body: string
}

/* ------------------------------------------------------------------ */
/* 6. Copy, buttons, recipients                                       */
/* ------------------------------------------------------------------ */

function humanName(raw?: string | null): string {
  const name = String(raw || '').trim()
  if (!name) return 'there'
  // Phone numbers, "[image]" and placeholder names are not a name.
  if (/^\+?\d[\d\s-]{6,}$/.test(name)) return 'there'
  if (/^\[.*\]$/.test(name)) return 'there'
  if (/^(customer|lead|prospect|valued lead|valued customer)$/i.test(name)) return 'there'
  return name.split(/\s+/).slice(0, 2).join(' ')
}

/**
 * Render one step's copy. Placeholders are the whole vocabulary the playbook may
 * use, so an owner's sentence can be stored as text without inventing facts.
 */
export function renderStepBody(
  body: string,
  ctx: { leadName?: string | null; businessName?: string | null; industry?: string | null }
): string {
  const vocab = industryVocabulary(ctx.industry)
  const business = String(ctx.businessName || '').trim() || 'our team'
  return String(body || '')
    .replace(/\{\{\s*name\s*\}\}/gi, humanName(ctx.leadName))
    .replace(/\{\{\s*business\s*\}\}/gi, business)
    .replace(/\{\{\s*product\s*\}\}/gi, vocab.productNoun)
    .replace(/\{\{\s*products\s*\}\}/gi, vocab.productNounPlural)
    .replace(/\{\{\s*catalogue\s*\}\}/gi, vocab.collectionHeading)
    .trim()
}

/**
 * Build the message for one step: exactly the three reply buttons, ids untouched,
 * resolved from the playbook so only the LABEL is contextual.
 */
export function buildLeadMessage(input: {
  row: Pick<JourneyStepRow, 'leadId' | 'userId' | 'stepId' | 'body' | 'template' | 'intent'>
  playbook?: Partial<Playbook> | null
  industry?: string | null
  businessName?: string | null
  leadName?: string | null
  phone?: string | null
  state: LeadJourneyState
  now: Date
}): OutboundLeadMessage {
  const buttons = resolveReplyButtons(input.playbook ?? null, input.industry)
  const windowExpires = input.state.windowExpiresAt ? new Date(input.state.windowExpiresAt).getTime() : 0
  return {
    // Test mode is a single choke point: nothing reaches a real customer.
    to: outboundRecipient(input.phone),
    body: renderStepBody(input.row.body, {
      leadName: input.leadName,
      businessName: input.businessName,
      industry: input.industry,
    }),
    buttons,
    template: input.row.template,
    windowOpen: windowExpires > input.now.getTime(),
    userId: input.row.userId,
    leadId: input.row.leadId,
    stepId: input.row.stepId,
    intent: input.row.intent,
    businessName: String(input.businessName || '').trim() || 'our team',
  }
}

/* ------------------------------------------------------------------ */
/* 7. The engine                                                      */
/* ------------------------------------------------------------------ */

export interface JourneyDeps {
  store: JourneyStore
  sender: JourneySender
  /** Injected clock. Nothing in this module calls new Date() for "now". */
  now: () => Date
  notifyOwner?: (notice: OwnerNotice) => Promise<void>
  log?: (entry: JourneyLogEntry) => void
}

export interface StartJourneyResult {
  /** true when this call created the steps, false when they already existed. */
  created: boolean
  enqueued: number
  steps: PlannedStep[]
}

/**
 * Start (or re-attach to) a lead's journey.
 *
 * Idempotent per (lead, step): the store's unique key decides. A duplicated
 * webhook delivery therefore changes nothing and sends nothing extra.
 */
export async function startJourney(
  deps: JourneyDeps,
  input: {
    journey: LeadJourney
    leadId: string
    userId: string
    campaignId?: string | null
    startedAt: Date
  }
): Promise<StartJourneyResult> {
  const steps = planJourney(input.journey, input.startedAt)
  let enqueued = 0
  for (const step of steps) {
    const { created } = await deps.store.enqueue({
      userId: input.userId,
      leadId: input.leadId,
      campaignId: input.campaignId ?? input.journey.campaignId ?? null,
      stepId: step.stepId,
      kind: step.kind,
      dueAt: step.dueAt.toISOString(),
      body: step.body,
      template: step.template,
      intent: step.intent,
    })
    if (created) enqueued++
  }

  if (enqueued > 0) {
    await deps.store.log({
      leadId: input.leadId,
      event: 'started',
      detail: `journey started: ${enqueued} step(s) planned at T${steps.map((s) => `+${s.offsetMinutes}m`).join(', T')}`,
      at: input.startedAt.toISOString(),
    })
  }

  return { created: enqueued > 0, enqueued, steps }
}

export interface ProcessResult {
  checked: number
  sent: number
  blocked: number
  cancelled: number
  /** Leads handed to a human because the journey had nothing safe left to say. */
  handoffs: number
  /** Verdicts for the tests and for the cron's diagnostics array. */
  actions: Array<{
    leadId: string
    stepId: JourneyStepId
    action: 'sent' | 'blocked' | 'cancelled' | 'handoff'
    reason?: string
  }>
}

export interface JourneyMessageContext {
  playbook: Partial<Playbook> | null
  industry: string | null
  businessName: string | null
  leadName: string | null
  phone: string | null
  /** Optional: lets a policy block use this tenant's own handoff wording. */
  journey?: LeadJourney | null
}

/**
 * Stop the journey and hand the lead to a person, telling the owner ONCE.
 *
 * Shared by the explicit "can I speak to a human" path and by the implicit one —
 * a step that policy refuses — because both mean the same thing operationally:
 * automation has run out of safe things to say.
 */
async function handOffLead(
  deps: JourneyDeps,
  input: {
    leadId: string
    userId: string
    journey?: LeadJourney | null
    reason: string
    alreadyHandedOff: boolean
    now: Date
  }
): Promise<{ cancelled: number; notifiedOwner: boolean }> {
  const journey = input.journey ?? defaultJourney()
  if (!input.alreadyHandedOff) {
    await deps.store.recordHandoff(input.leadId, input.now, input.reason)
  }
  const cancelled = await deps.store.cancelPendingForLead(input.leadId, `handoff:${input.reason}`, input.now)
  await log(deps, {
    leadId: input.leadId,
    event: 'handoff',
    detail: `${input.reason} — ${cancelled} pending step(s) cancelled${input.alreadyHandedOff ? ' (already handed off)' : ''}`,
    at: input.now.toISOString(),
  })

  if (input.alreadyHandedOff || !deps.notifyOwner) {
    return { cancelled, notifiedOwner: false }
  }
  await deps.notifyOwner({
    userId: input.userId,
    leadId: input.leadId,
    title: journey.handoff.noticeTitle,
    body: journey.handoff.noticeBody,
  })
  return { cancelled, notifiedOwner: true }
}

/**
 * Send everything that is due, once.
 *
 * Order matters: the lead's own state is re-read BEFORE the send, so an opt-out
 * that arrived after the step was queued still suppresses it, even if the step is
 * already `pending` and due.
 */
export async function processDueSteps(
  deps: JourneyDeps,
  input: {
    limit?: number
    leadId?: string
    /** The tenant's journey, so a policy block can use their handoff wording. */
    journey?: LeadJourney | null
    /** Default true: a blocked step hands the lead to a human. */
    handoffOnBlock?: boolean
    /** Everything the message needs that the step row does not carry. */
    contextFor?: (row: JourneyStepRow) => Promise<JourneyMessageContext>
  } = {}
): Promise<ProcessResult> {
  const now = deps.now()
  const result: ProcessResult = { checked: 0, sent: 0, blocked: 0, cancelled: 0, handoffs: 0, actions: [] }
  const rows = await deps.store.due(now, { leadId: input.leadId, limit: input.limit ?? 50 })

  for (const row of rows) {
    result.checked++
    const state = await deps.store.leadState(row.leadId)

    // 1. Opt-out / handoff beat everything: cancel instead of sending.
    if (state.optedOutAt) {
      await deps.store.markCancelled(row.id, 'opted_out', now)
      await log(deps, {
        leadId: row.leadId,
        stepId: row.stepId,
        event: 'skipped',
        detail: `step ${row.stepId} suppressed: the lead opted out at ${state.optedOutAt}`,
        at: now.toISOString(),
      })
      result.cancelled++
      result.actions.push({ leadId: row.leadId, stepId: row.stepId, action: 'cancelled', reason: 'opted_out' })
      continue
    }
    if (state.handoffAt) {
      await deps.store.markCancelled(row.id, 'handed_off', now)
      await log(deps, {
        leadId: row.leadId,
        stepId: row.stepId,
        event: 'skipped',
        detail: `step ${row.stepId} suppressed: a human took over at ${state.handoffAt}`,
        at: now.toISOString(),
      })
      result.cancelled++
      result.actions.push({ leadId: row.leadId, stepId: row.stepId, action: 'cancelled', reason: 'handed_off' })
      continue
    }

    // 2. Claim before building: two workers must never both send this step.
    const claimed = await deps.store.claim(row.id, now)
    if (!claimed) continue

    const ctx = input.contextFor
      ? await input.contextFor(claimed)
      : { playbook: null, industry: null, businessName: null, leadName: null, phone: null }

    const message = buildLeadMessage({
      row: claimed,
      playbook: ctx.playbook,
      industry: ctx.industry,
      businessName: ctx.businessName,
      leadName: ctx.leadName,
      phone: ctx.phone,
      state,
      now,
    })

    // 3. Policy: a violation is BLOCKED and LOGGED with its reason.
    const verdict: PolicyVerdict = checkLeadMessagePolicy({
      to: message.to,
      body: message.body,
      buttons: message.buttons,
      template: message.template,
      industry: ctx.industry,
      windowOpen: message.windowOpen,
    })

    if (!verdict.allowed) {
      const reason = `${verdict.code}: ${verdict.reason || 'blocked by lead message policy'}`
      await deps.store.markBlocked(claimed.id, reason, now)
      await log(deps, {
        leadId: claimed.leadId,
        stepId: claimed.stepId,
        event: 'blocked',
        detail: `step ${claimed.stepId} blocked — ${reason}`,
        at: now.toISOString(),
      })
      result.blocked++
      result.actions.push({ leadId: claimed.leadId, stepId: claimed.stepId, action: 'blocked', reason })

      // "Nothing safe left to say" is a HANDOFF, not a dead end: stop the rest of
      // the journey, mark the lead for a person, and tell the owner once. A
      // blocked message that simply vanished would leave a lead waiting forever.
      if (input.handoffOnBlock !== false) {
        const handedOff = await handOffLead(deps, {
          leadId: claimed.leadId,
          userId: claimed.userId,
          journey: ctx.journey ?? input.journey,
          reason: `no_safe_message:${verdict.code}`,
          alreadyHandedOff: !!state.handoffAt,
          now,
        })
        if (handedOff.cancelled > 0) result.cancelled += handedOff.cancelled
        if (handedOff.notifiedOwner) result.handoffs++
        result.actions.push({
          leadId: claimed.leadId,
          stepId: claimed.stepId,
          action: 'handoff',
          reason: `no_safe_message:${verdict.code}`,
        })
      }
      continue
    }

    // 4. Send.
    let send: SendResult
    try {
      send = await deps.sender.send(message)
    } catch (e: any) {
      send = { ok: false, channel: 'unknown', error: String(e?.message || e) }
    }

    if (send.ok) {
      await deps.store.markSent(claimed.id, now)
      await log(deps, {
        leadId: claimed.leadId,
        stepId: claimed.stepId,
        event: 'sent',
        detail: `step ${claimed.stepId} sent via ${send.channel} to ${message.to}`,
        at: now.toISOString(),
      })
      result.sent++
      result.actions.push({ leadId: claimed.leadId, stepId: claimed.stepId, action: 'sent' })
    } else {
      const reason = `send_failed: ${send.error || 'the channel refused the message'}`
      await deps.store.markBlocked(claimed.id, reason, now)
      await log(deps, {
        leadId: claimed.leadId,
        stepId: claimed.stepId,
        event: 'blocked',
        detail: `step ${claimed.stepId} failed at the channel — ${reason}`,
        at: now.toISOString(),
      })
      result.blocked++
      result.actions.push({ leadId: claimed.leadId, stepId: claimed.stepId, action: 'blocked', reason })
    }
  }

  return result
}

export interface InboundIntentResult {
  kind: LeadIntentKind
  matched: string | null
  /** Steps stopped by this message. */
  cancelled: number
  /** True when the owner was told about a handoff by this call. */
  notifiedOwner: boolean
}

/**
 * Apply one inbound lead message to the journey.
 *
 * Opt-out: cancel everything now. Handoff: cancel everything, mark the lead for a
 * human, notify the owner ONCE (the lead's own state is the guard, so the second
 * "talk to a person" message does not ring the owner twice).
 */
export async function applyInboundIntent(
  deps: JourneyDeps,
  input: {
    journey: LeadJourney
    leadId: string
    userId: string
    text?: string | null
    buttonId?: string | null
  }
): Promise<InboundIntentResult> {
  const now = deps.now()
  const intent = classifyLeadReply({ text: input.text, buttonId: input.buttonId, journey: input.journey })

  if (intent.kind === 'opt_out') {
    await deps.store.recordOptOut(input.leadId, now, intent.matched)
    const cancelled = await deps.store.cancelPendingForLead(input.leadId, `opt_out:${intent.matched}`, now)
    await log(deps, {
      leadId: input.leadId,
      event: 'opt_out',
      detail: `opt-out ("${intent.matched}") cancelled ${cancelled} pending step(s)`,
      at: now.toISOString(),
    })
    return { kind: 'opt_out', matched: intent.matched, cancelled, notifiedOwner: false }
  }

  if (intent.kind === 'handoff') {
    const state = await deps.store.leadState(input.leadId)
    const handedOff = await handOffLead(deps, {
      leadId: input.leadId,
      userId: input.userId,
      journey: input.journey,
      reason: `asked:${intent.matched}`,
      alreadyHandedOff: !!state.handoffAt,
      now,
    })
    return {
      kind: 'handoff',
      matched: intent.matched,
      cancelled: handedOff.cancelled,
      notifiedOwner: handedOff.notifiedOwner,
    }
  }

  return { kind: 'neutral', matched: null, cancelled: 0, notifiedOwner: false }
}

async function log(deps: JourneyDeps, entry: JourneyLogEntry): Promise<void> {
  try {
    await deps.store.log(entry)
  } catch (e: any) {
    console.warn('[Journey] could not write the audit line:', e?.message || e)
  }
  try {
    deps.log?.(entry)
  } catch {
    /* a logging hook must never break a send */
  }
}

/* ------------------------------------------------------------------ */
/* 8. An in-memory store — the tests run on this, nothing else        */
/* ------------------------------------------------------------------ */

export interface MemoryJourneyStore extends JourneyStore {
  rows: JourneyStepRow[]
  logs: JourneyLogEntry[]
  state: Map<string, LeadJourneyState>
}

/**
 * A complete JourneyStore with the same contract as the Supabase one, including
 * the unique `(lead, step)` key and the `pending -> sending` claim. Used by
 * `scripts/verify-journey.ts` and nothing else.
 */
export function createMemoryJourneyStore(opts: {
  /** Defaults to "the window is open", i.e. free-form is allowed. */
  windowExpiresAt?: string | null
} = {}): MemoryJourneyStore {
  const rows: JourneyStepRow[] = []
  const logs: JourneyLogEntry[] = []
  const state = new Map<string, LeadJourneyState>()
  let seq = 0

  const stateFor = (leadId: string): LeadJourneyState => {
    if (!state.has(leadId)) {
      state.set(leadId, {
        optedOutAt: null,
        handoffAt: null,
        windowExpiresAt: opts.windowExpiresAt === undefined
          ? new Date(Date.now() + 24 * 3600_000).toISOString()
          : opts.windowExpiresAt,
      })
    }
    return state.get(leadId)!
  }

  return {
    rows,
    logs,
    state,
    async enqueue(input) {
      const existing = rows.find((r) => r.leadId === input.leadId && r.stepId === input.stepId)
      if (existing) return { row: existing, created: false }
      const row: JourneyStepRow = {
        id: input.key || `mem_${++seq}`,
        userId: input.userId,
        leadId: input.leadId,
        campaignId: input.campaignId ?? null,
        stepId: input.stepId,
        kind: input.kind,
        status: 'pending',
        dueAt: input.dueAt,
        body: input.body,
        template: input.template ?? null,
        intent: input.intent,
        attempts: 0,
        sentAt: null,
        cancelledAt: null,
        cancelReason: null,
        blockedReason: null,
      }
      rows.push(row)
      return { row, created: true }
    },
    async due(now, o = {}) {
      return rows
        .filter((r) => r.status === 'pending')
        .filter((r) => (o.leadId ? r.leadId === o.leadId : true))
        .filter((r) => new Date(r.dueAt).getTime() <= now.getTime())
        .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
        .slice(0, o.limit ?? 100)
    },
    async claim(id) {
      const row = rows.find((r) => r.id === id)
      if (!row || row.status !== 'pending') return null
      row.status = 'sending'
      row.attempts++
      return { ...row }
    },
    async markSent(id, at) {
      const row = rows.find((r) => r.id === id)
      if (row) {
        row.status = 'sent'
        row.sentAt = at.toISOString()
      }
    },
    async markCancelled(id, reason, at) {
      const row = rows.find((r) => r.id === id)
      if (row) {
        row.status = 'cancelled'
        row.cancelledAt = at.toISOString()
        row.cancelReason = reason
      }
    },
    async markBlocked(id, reason, at) {
      const row = rows.find((r) => r.id === id)
      if (row) {
        row.status = 'blocked'
        row.blockedReason = reason
        row.cancelledAt = at.toISOString()
      }
    },
    async cancelPendingForLead(leadId, reason, at) {
      let n = 0
      for (const row of rows) {
        if (row.leadId !== leadId) continue
        if (row.status !== 'pending') continue
        row.status = 'cancelled'
        row.cancelledAt = at.toISOString()
        row.cancelReason = reason
        n++
      }
      return n
    },
    async leadState(leadId) {
      return stateFor(leadId)
    },
    async recordOptOut(leadId, at) {
      stateFor(leadId).optedOutAt = at.toISOString()
    },
    async recordHandoff(leadId, at) {
      stateFor(leadId).handoffAt = at.toISOString()
    },
    async log(entry) {
      logs.push(entry)
    },
  }
}

/** A sender that records instead of dialling. */
export function createRecordingSender(opts: { fail?: boolean; channel?: string } = {}): JourneySender & { sent: OutboundLeadMessage[] } {
  const sent: OutboundLeadMessage[] = []
  return {
    sent,
    async send(message) {
      sent.push(message)
      if (opts.fail) return { ok: false, channel: opts.channel || 'recording', error: 'simulated channel failure' }
      return { ok: true, channel: opts.channel || 'recording' }
    },
  }
}

/** True when outbound test mode is on — handy for diagnostics and the cron. */
export function journeyTestMode(): boolean {
  return isOutboundTestMode()
}
