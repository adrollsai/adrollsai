import type { SupabaseClient } from '@supabase/supabase-js';
import { dispatchVoiceCall, sendWhatsAppTemplate, sendWhatsAppText } from '@/lib/agent/tools/outbound';
import { isOutboundTestMode, outboundRecipient } from '@/lib/automation/test-mode';

/**
 * The destination flow steps never had.
 *
 * The scheduler (/api/cron/flows) has always queued each due step as a row in
 * `agent_pending_deliveries` with status `pending_approval`, on purpose: a flow is allowed to
 * decide WHO to contact and WHAT to say, but a person decides whether it goes out. What was
 * missing was everything after that write — no approvals queue, no dispatcher, and the table did
 * not even carry the columns the insert named. A queue nothing reads is not a queue; it is a
 * graveyard, and it read as "flows work" to anybody looking at the schedule table.
 *
 * This module is the missing half, and it is split the same way the rest of the flow machinery is:
 *
 *   plan (pure)     — what MAY be sent, and every reason it may not be.
 *   decide          — a human says yes or no. Approving still sends nothing.
 *   dispatch        — one claimed row, one honest result: a provider id, or the error text.
 *
 * Three rules hold this together:
 *   1. NOTHING is sent that a human did not approve. There is no "auto-approve" setting, because
 *      the only way to be sure a customer is not messaged by a machine is to have no such switch.
 *   2. A template is always sendable; free-form text is only legal inside WhatsApp's 24-hour
 *      service window, so it is refused rather than attempted when the window is shut.
 *   3. Every recipient passes through outboundRecipient(), so with OUTBOUND_TEST_MODE on the
 *      message lands on the founder's phone and the delivery row says so.
 */

export const DELIVERIES = 'agent_pending_deliveries';

/** How long a dispatch claim is honoured before another worker may retry the row. */
export const CLAIM_SECONDS = 180;

/** A pending approval nobody looked at for this long is stale, not pending. */
export const STALE_APPROVAL_HOURS = 72;

/** Free text and quick-reply buttons are only legal inside this window. */
export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

export type DeliveryStatus =
  | 'waiting_handshake'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'sending'
  | 'delivered'
  | 'failed'
  | 'blocked'
  | 'expired';

export interface Delivery {
  id: string;
  userId: string;
  leadId: string | null;
  leadName?: string | null;
  leadPhone?: string | null;
  channel: 'whatsapp' | 'call';
  toPhone: string | null;
  body: string | null;
  templateName: string | null;
  flowId: string | null;
  flowStepIndex: number | null;
  trigger: string | null;
  runKey: string;
  status: DeliveryStatus;
  attempts: number;
  errorMessage: string | null;
  providerMessageId: string | null;
  createdAt: string;
  approvedAt: string | null;
  sentAt: string | null;
}

export function mapDelivery(row: any): Delivery {
  return {
    id: String(row.id),
    userId: String(row.user_id ?? ''),
    leadId: row.lead_id ? String(row.lead_id) : null,
    leadName: row.lead_name ?? null,
    leadPhone: row.lead_phone ?? null,
    channel: String(row.channel ?? '') === 'call' ? 'call' : 'whatsapp',
    toPhone: row.to_phone ? String(row.to_phone) : null,
    body: row.body ? String(row.body) : null,
    templateName: row.template_name ? String(row.template_name) : null,
    flowId: row.flow_id ? String(row.flow_id) : null,
    flowStepIndex: row.flow_step_index === null || row.flow_step_index === undefined ? null : Number(row.flow_step_index),
    trigger: row.trigger ? String(row.trigger) : null,
    runKey: String(row.run_key ?? 'once'),
    status: String(row.status ?? 'pending_approval') as DeliveryStatus,
    attempts: Number(row.attempts ?? 0),
    errorMessage: row.error_message ? String(row.error_message) : null,
    providerMessageId: row.provider_message_id ? String(row.provider_message_id) : null,
    createdAt: String(row.created_at ?? ''),
    approvedAt: row.approved_at ?? null,
    sentAt: row.sent_at ?? null,
  };
}

/** One sentence a person can act on, used in the queue and in the agent's answers. */
export function describeDelivery(d: Delivery): string {
  const who = d.leadName ? `${d.leadName}${d.leadPhone ? ` (${d.leadPhone})` : ''}` : d.toPhone || d.leadPhone || 'a lead with no number';
  const what = d.channel === 'call' ? 'an AI call' : d.templateName ? `the template "${d.templateName}"` : 'a WhatsApp message';
  return `Send ${what} to ${who}`;
}

export interface DispatchBlocker {
  code:
    | 'no_lead'
    | 'no_phone'
    | 'no_content'
    | 'window_closed'
    | 'opted_out'
    | 'test_mode_unconfigured'
    | 'unsupported_channel';
  message: string;
}

export interface DispatchFacts {
  /** WhatsApp's 24-hour service window — the only thing that makes free text legal. */
  windowOpen: boolean;
  optedOut: boolean;
}

/**
 * Everything that stops this delivery from going out, in the order a person would check it.
 * A template send needs no window; free text does. That distinction is the whole reason this is a
 * list of blockers rather than a boolean.
 */
export function dispatchBlockers(d: Delivery, facts: DispatchFacts): DispatchBlocker[] {
  const blockers: DispatchBlocker[] = [];
  const phone = String(d.toPhone || d.leadPhone || '').replace(/\D/g, '');

  if (!d.leadId) {
    blockers.push({ code: 'no_lead', message: 'This step is not attached to a lead, so nobody can be reached.' });
  }
  if (!phone) {
    blockers.push({ code: 'no_phone', message: 'The lead has no phone number on record.' });
  }
  if (facts.optedOut) {
    blockers.push({ code: 'opted_out', message: 'This person asked not to be contacted; nothing will be sent.' });
  }
  if (isOutboundTestMode() && !outboundRecipient(phone)) {
    blockers.push({
      code: 'test_mode_unconfigured',
      message: 'Test mode is on but OUTBOUND_TEST_NUMBER is unset, so sending is refused rather than going to a customer.',
    });
  }

  if (d.channel === 'call') {
    if (!String(d.body || '').trim()) {
      blockers.push({ code: 'no_content', message: 'The call step has no objective, so the AI would dial with nothing to say.' });
    }
    return blockers;
  }

  if (!String(d.body || '').trim() && !d.templateName) {
    blockers.push({ code: 'no_content', message: 'The step has neither message text nor a template, so there is nothing to send.' });
  }
  // A template is pre-approved by Meta and legal at any hour. Free text is not.
  if (!d.templateName && String(d.body || '').trim() && !facts.windowOpen) {
    blockers.push({
      code: 'window_closed',
      message:
        'This person has not messaged in the last 24 hours, so WhatsApp only accepts an approved template. ' +
        'Attach a template to the step, or send it after they reply.',
    });
  }
  return blockers;
}

async function factsFor(d: Delivery, supabase: SupabaseClient): Promise<DispatchFacts> {
  let windowOpen = false;
  let optedOut = false;
  if (d.leadId) {
    const { data } = await supabase
      .from('leads')
      .select('id, opted_out, pipeline_stage, whatsapp_window_expires_at')
      .eq('id', d.leadId)
      .maybeSingle();
    if (data) {
      const stage = String((data as any).pipeline_stage ?? '').toLowerCase();
      optedOut = (data as any).opted_out === true || stage === 'opted_out' || stage === 'unsubscribed';
      const expires = (data as any).whatsapp_window_expires_at;
      windowOpen = !!expires && new Date(String(expires)).getTime() > Date.now();
    }
  }
  return { windowOpen, optedOut };
}

/** The approvals queue, oldest first. Service-role client; the caller scopes by user. */
export async function listDeliveries(
  supabase: SupabaseClient,
  userId: string,
  opts: { status?: DeliveryStatus[]; limit?: number } = {}
): Promise<Delivery[]> {
  const statuses = opts.status ?? ['pending_approval'];
  const { data, error } = await supabase
    .from(DELIVERIES)
    .select(
      'id, user_id, lead_id, channel, to_phone, body, template_name, flow_id, flow_step_index, trigger, run_key, status, attempts, error_message, provider_message_id, created_at, approved_at, sent_at'
    )
    .eq('user_id', userId)
    .in('status', statuses)
    .order('created_at', { ascending: true })
    .limit(opts.limit ?? 50);
  if (error) throw new Error(`could not read the delivery queue: ${error.message}`);

  const deliveries = (data ?? []).map(mapDelivery);
  const leadIds = Array.from(new Set(deliveries.map((d) => d.leadId).filter(Boolean))) as string[];
  if (leadIds.length) {
    const { data: leads } = await supabase.from('leads').select('id, name, phone').in('id', leadIds);
    const byId = new Map((leads ?? []).map((l: any) => [String(l.id), l]));
    for (const d of deliveries) {
      const lead: any = d.leadId ? byId.get(d.leadId) : null;
      if (lead) {
        d.leadName = lead.name ?? null;
        d.leadPhone = lead.phone ?? null;
        if (!d.toPhone) d.toPhone = lead.phone ?? null;
      }
    }
  }
  return deliveries;
}

export interface DecideResult {
  ok: boolean;
  status?: DeliveryStatus;
  delivery?: Delivery;
  error?: string;
}

/**
 * A human decided. Approving only moves the row to `approved`; dispatch is a separate,
 * visible step so "approved" can never be mistaken for "sent".
 */
export async function decideDelivery(
  supabase: SupabaseClient,
  input: { userId: string; deliveryId: string; decision: 'approve' | 'reject'; decidedBy?: string | null }
): Promise<DecideResult> {
  const { data: row, error } = await supabase
    .from(DELIVERIES)
    .select('*')
    .eq('id', input.deliveryId)
    .eq('user_id', input.userId)
    .maybeSingle();
  if (error) return { ok: false, error: `could not read that delivery: ${error.message}` };
  if (!row) return { ok: false, error: 'No such delivery for this account.' };

  const delivery = mapDelivery(row);
  if (delivery.status !== 'pending_approval') {
    return { ok: false, error: `This delivery is already ${delivery.status}, so it cannot be decided again.` };
  }

  const now = new Date().toISOString();
  const patch =
    input.decision === 'approve'
      ? { status: 'approved', approved_at: now, approved_by: input.decidedBy ?? input.userId, decided_at: now, error_message: null }
      : { status: 'rejected', decided_at: now, approved_by: input.decidedBy ?? input.userId };

  // Compare-and-set on the status we just read: two clicks, or a click racing the cron, cannot
  // both win, and a decided row can never be re-opened by a stale tab.
  const { data: updated, error: updateError } = await supabase
    .from(DELIVERIES)
    .update(patch)
    .eq('id', delivery.id)
    .eq('status', 'pending_approval')
    .select('*');
  if (updateError) return { ok: false, error: `could not update that delivery: ${updateError.message}` };
  if (!updated?.length) return { ok: false, error: 'That delivery was decided a moment ago by something else.' };

  return { ok: true, status: patch.status as DeliveryStatus, delivery: mapDelivery(updated[0]) };
}

export interface DispatchOutcome {
  id: string;
  status: DeliveryStatus;
  /** What actually happened, in words, for the queue and the log. */
  detail: string;
  to?: string;
  providerMessageId?: string;
}

/**
 * Send ONE approved delivery, after claiming it.
 *
 * Returns the truth in every branch: `delivered` only when a provider accepted it, `blocked` when
 * a rule refused it (and why), `failed` when the provider did. Nothing is retried forever — an
 * attempt counter and the claim window mean a wedged row is visible rather than looping.
 */
export async function dispatchDelivery(supabase: SupabaseClient, delivery: Delivery): Promise<DispatchOutcome> {
  const facts = await factsFor(delivery, supabase);
  const blockers = dispatchBlockers(delivery, facts);
  if (blockers.length) {
    const detail = blockers.map((b) => b.message).join(' ');
    await supabase
      .from(DELIVERIES)
      .update({ status: 'blocked', error_message: detail, decided_at: new Date().toISOString() })
      .eq('id', delivery.id);
    return { id: delivery.id, status: 'blocked', detail };
  }

  const now = new Date();
  const claimUntil = new Date(now.getTime() + CLAIM_SECONDS * 1000).toISOString();
  // Claim: only an approved row can become `sending`, so two workers cannot both send it.
  const { data: claimed } = await supabase
    .from(DELIVERIES)
    .update({ status: 'sending', claim_expires_at: claimUntil, attempts: delivery.attempts + 1 })
    .eq('id', delivery.id)
    .eq('status', 'approved')
    .select('id');
  if (!claimed?.length) {
    return { id: delivery.id, status: delivery.status, detail: 'Another worker is already sending this one.' };
  }

  const phone = String(delivery.toPhone || delivery.leadPhone || '').replace(/\D/g, '');
  const fail = async (error: string): Promise<DispatchOutcome> => {
    await supabase
      .from(DELIVERIES)
      .update({ status: 'failed', error_message: error })
      .eq('id', delivery.id);
    return { id: delivery.id, status: 'failed', detail: error };
  };

  if (delivery.channel === 'call') {
    const result = await dispatchVoiceCall({
      supabase,
      userId: delivery.userId,
      phone,
      leadName: delivery.leadName ?? undefined,
      objective: String(delivery.body || '').trim() || 'Follow up with this lead about their enquiry.',
      reason: 'aapki enquiry',
    });
    if (!result.success) return fail(result.error || 'The voice provider refused the call.');
    await supabase
      .from(DELIVERIES)
      .update({ status: 'delivered', delivered_at: new Date().toISOString(), sent_at: new Date().toISOString(), provider_message_id: result.callSid ?? null })
      .eq('id', delivery.id);
    return {
      id: delivery.id,
      status: 'delivered',
      detail: `Call placed to ${result.to}${result.scheduled ? ' (scheduled)' : ''}.`,
      to: result.to,
      providerMessageId: result.callSid,
    };
  }

  if (delivery.templateName) {
    const result = await sendWhatsAppTemplate({
      supabase,
      userId: delivery.userId,
      phone,
      templateName: delivery.templateName,
      variables: [],
    });
    if (!result.success) return fail(result.error || 'Meta refused the template.');
    await supabase
      .from(DELIVERIES)
      .update({ status: 'delivered', delivered_at: new Date().toISOString(), sent_at: new Date().toISOString(), provider_message_id: result.messageId ?? null })
      .eq('id', delivery.id);
    return {
      id: delivery.id,
      status: 'delivered',
      detail: `Template "${delivery.templateName}" accepted by Meta for ${result.to}.`,
      to: result.to,
      providerMessageId: result.messageId,
    };
  }

  const result = await sendWhatsAppText({
    supabase,
    userId: delivery.userId,
    phone,
    text: String(delivery.body || ''),
  });
  if (!result.success) return fail(result.error || 'Meta refused the message.');
  await supabase
    .from(DELIVERIES)
    .update({ status: 'delivered', delivered_at: new Date().toISOString(), sent_at: new Date().toISOString(), provider_message_id: result.messageId ?? null })
    .eq('id', delivery.id);
  return {
    id: delivery.id,
    status: 'delivered',
    detail: `Message accepted by Meta for ${result.to}${result.redirected ? ' (test mode redirected it)' : ''}.`,
    to: result.to,
    providerMessageId: result.messageId,
  };
}

/**
 * Dispatch everything a human has approved. Runs from the flows cron.
 *
 * Deliberately only reads `approved`: a `pending_approval` row is somebody's decision to make,
 * not work to do.
 */
export async function dispatchApprovedDeliveries(
  supabase: SupabaseClient,
  opts: { userId?: string; limit?: number } = {}
): Promise<{ considered: number; outcomes: DispatchOutcome[] }> {
  let query = supabase
    .from(DELIVERIES)
    .select('*')
    .eq('status', 'approved')
    .order('decided_at', { ascending: true })
    .limit(opts.limit ?? 25);
  if (opts.userId) query = query.eq('user_id', opts.userId);

  const { data, error } = await query;
  if (error) return { considered: 0, outcomes: [] };

  const outcomes: DispatchOutcome[] = [];
  for (const row of data ?? []) {
    outcomes.push(await dispatchDelivery(supabase, mapDelivery(row)));
  }
  return { considered: (data ?? []).length, outcomes };
}

/**
 * Recover rows a crashed/expired worker left in `sending`, so they are not wedged for ever.
 * They go back to `approved` — a human already said yes — and are retried once.
 */
export async function releaseStaleClaims(supabase: SupabaseClient, now = new Date()): Promise<number> {
  const { data } = await supabase
    .from(DELIVERIES)
    .select('id')
    .eq('status', 'sending')
    .lt('claim_expires_at', now.toISOString())
    .limit(50);
  const ids = (data ?? []).map((r: any) => String(r.id));
  if (!ids.length) return 0;
  await supabase
    .from(DELIVERIES)
    .update({ status: 'approved', claim_expires_at: null, error_message: 'The previous send attempt expired before it reported back.' })
    .in('id', ids);
  return ids.length;
}

/** Old pending approvals stop being "pending" and become "expired", so the queue stays honest. */
export async function expireStaleDeliveries(
  supabase: SupabaseClient,
  olderThanHours = STALE_APPROVAL_HOURS,
  now = new Date()
): Promise<number> {
  const cutoff = new Date(now.getTime() - olderThanHours * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from(DELIVERIES)
    .select('id')
    .eq('status', 'pending_approval')
    .lt('created_at', cutoff)
    .limit(100);
  const ids = (data ?? []).map((r: any) => String(r.id));
  if (!ids.length) return 0;
  await supabase
    .from(DELIVERIES)
    .update({
      status: 'expired',
      decided_at: now.toISOString(),
      error_message: `Nobody decided within ${olderThanHours} hours, so this flow step was not sent.`,
    })
    .in('id', ids);
  return ids.length;
}
