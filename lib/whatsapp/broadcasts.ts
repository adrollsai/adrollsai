import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchLeadsForAudience } from '@/lib/audiences/groups';
import { describeTarget, selectCampaignRecipients, type RecipientCriteria } from '@/lib/audiences/targets';
import { normalisePhone } from '@/lib/audiences/filters';
import { templateStatus, whatsAppCredentials } from './templates';

/**
 * Starting a WhatsApp campaign to an audience.
 *
 * The UI path (app/api/whatsapp/broadcasts) creates a broadcast row, then either sends it inline or
 * leaves it for the 10-minute reconciler. This module does the same DB work but deliberately does
 * NOT send inline: it writes the broadcast and its recipient rows, and the scheduler sends them.
 *
 * WHY THAT MATTERS
 *   - the human approval happens BEFORE any row exists (the tool is gated), so an approved campaign
 *     is one the owner has already seen the size and wording of;
 *   - a serverless request that tries to send 400 template messages is how a campaign ends up half
 *     delivered with no record of where it stopped. The worker already handles batching, throttling
 *     and the payment/permission circuit breaker.
 *
 * Everything that would make Meta reject the send is checked first and reported: no template, a
 * template Meta has not approved, no connected WABA, or no reachable recipients.
 */

export interface BroadcastInput {
  userId: string;
  title: string;
  templateName: string;
  /** Target one saved audience group. */
  audienceGroupName?: string | null;
  /** Or target filters directly (same shape as the Audience Maker). */
  audienceFilter?: RecipientCriteria['audienceFilter'];
  recipientStage?: string | null;
  recipientPropertyId?: string | null;
  recipientCsvAudience?: string | null;
  /** ISO timestamp; omitted means "send on the next scheduler tick". */
  scheduledAt?: string | null;
  /** Hard cap on recipients, for a deliberately small test send. */
  limit?: number | null;
  languageCode?: string | null;
}

export interface BroadcastResult {
  ok: boolean;
  broadcastId?: string;
  recipients: number;
  unreachable: { id: string; name: string | null; reason: string }[];
  audience: string;
  scheduledFor: string | null;
  template: string;
  /** True when the scheduler will send it on its next tick rather than a request doing it now. */
  queuedForScheduler: boolean;
  problems?: string[];
  error?: string;
}

function criteriaFor(input: BroadcastInput, groupName: string | null): RecipientCriteria {
  if (input.audienceFilter) {
    return {
      audienceFilter: input.audienceFilter,
      recipientStage: input.recipientStage ?? null,
      recipientPropertyId: input.recipientPropertyId ?? null,
      recipientCsvAudience: input.recipientCsvAudience ?? null,
    };
  }
  if (groupName) {
    // A saved group is targeted the way the UI targets it: by tag, both storages.
    return { audienceFilter: { targetType: 'audience_group', audienceGroupName: groupName }, recipientCsvAudience: groupName };
  }
  return {
    audienceFilter: null,
    recipientStage: input.recipientStage ?? null,
    recipientPropertyId: input.recipientPropertyId ?? null,
    recipientCsvAudience: input.recipientCsvAudience ?? null,
  };
}

/**
 * Create the broadcast and its recipient rows. Sends nothing itself.
 *
 * Returns the counts a person needs to judge it: how many will be messaged, and how many matched but
 * cannot be reached, with the reason for each — a campaign that quietly skips a third of an audience
 * is a campaign whose report is wrong.
 */
export async function createAudienceBroadcast(
  supabase: SupabaseClient,
  input: BroadcastInput
): Promise<BroadcastResult> {
  const title = String(input.title ?? '').trim();
  const templateName = String(input.templateName ?? '').trim();
  const groupName = String(input.audienceGroupName ?? '').trim() || null;
  const audience = describeTarget(criteriaFor(input, groupName));

  const base: BroadcastResult = {
    ok: false,
    recipients: 0,
    unreachable: [],
    audience,
    scheduledFor: input.scheduledAt ?? null,
    template: templateName,
    queuedForScheduler: false,
  };

  const problems: string[] = [];
  if (!title) problems.push('a campaign needs a title — it is what the owner sees in the broadcasts list');
  if (!templateName) problems.push('a campaign needs an approved WhatsApp template name');

  const credentials = await whatsAppCredentials(supabase, input.userId);
  if (!credentials) {
    problems.push(
      'WhatsApp is not connected for this account (no access token / WABA id), so nothing could be sent. ' +
        'Connect the WABA in settings first.'
    );
  }

  if (templateName) {
    const status = await templateStatus(supabase, input.userId, templateName);
    if (!status.known) {
      problems.push(
        `Meta has no template called "${templateName}" on this account, so the send would fail for every recipient. ` +
          'Create it first (create_whatsapp_template) or use one that is APPROVED.'
      );
    } else if (!status.approved) {
      problems.push(
        `the template "${templateName}" is ${status.status} at Meta, not APPROVED, so a send would be rejected. ` +
          'Wait for Meta to review it, or pick an approved one.'
      );
    }
  }

  if (problems.length) return { ...base, problems };

  const { leads } = await fetchLeadsForAudience(supabase, input.userId);
  const selection = selectCampaignRecipients(leads, criteriaFor(input, groupName), {
    channel: 'whatsapp',
    ...(input.limit ? { limit: Number(input.limit) } : {}),
  });

  if (!selection.selected.length) {
    return {
      ...base,
      unreachable: selection.unreachable.slice(0, 20),
      problems: [
        `no reachable lead matches ${audience}, so nothing was queued. ` +
          (selection.unreachable.length
            ? `${selection.unreachable.length} matched but could not be messaged (no phone number, or WhatsApp turned off).`
            : 'No lead matches that audience at all.'),
      ],
    };
  }

  const broadcastRow: Record<string, unknown> = {
    user_id: input.userId,
    title,
    template_name: templateName,
    recipient_stage: input.recipientStage ?? 'All',
    recipient_property_id: input.recipientPropertyId ?? null,
    scheduled_at: input.scheduledAt ?? null,
    // The scheduler picks up `processing` (and `pending` once scheduled_at passes) and sends in
    // batches. Nothing is sent from this request.
    status: input.scheduledAt ? 'pending' : 'processing',
    created_at: new Date().toISOString(),
  };
  const audienceColumn = groupName ?? input.recipientCsvAudience ?? null;

  // `recipient_csv_audience` is not present in every environment: the UI route carries the same
  // fallback for the same reason. The recipients we already selected are what actually gets
  // messaged, so losing this bookkeeping column costs a label, not the campaign.
  let created = await supabase
    .from('whatsapp_broadcasts')
    .insert({ ...broadcastRow, ...(audienceColumn ? { recipient_csv_audience: audienceColumn } : {}) })
    .select('id')
    .single();

  if (created.error && /recipient_csv_audience/i.test(created.error.message)) {
    created = await supabase.from('whatsapp_broadcasts').insert(broadcastRow).select('id').single();
  }

  const broadcast = created.data;
  const broadcastError = created.error;

  if (broadcastError || !broadcast?.id) {
    return { ...base, error: `could not create the campaign: ${broadcastError?.message ?? 'unknown error'}` };
  }

  const broadcastId = String(broadcast.id);
  const recipients = selection.selected.map((lead) => ({
    broadcast_id: broadcastId,
    lead_id: String(lead.id),
    user_id: input.userId,
    phone_number: String(lead.phone ?? '').trim(),
    status: 'pending',
  }));

  const { error: recipientError } = await supabase.from('whatsapp_broadcast_recipients').insert(recipients);
  if (recipientError) {
    // A campaign row with no recipients is a lie in the broadcasts list: it would sit at
    // "processing" and then be marked sent having messaged nobody. Take it back out.
    await supabase.from('whatsapp_broadcasts').delete().eq('id', broadcastId).eq('user_id', input.userId);
    return {
      ...base,
      error: `could not queue the recipients (${recipientError.message}), so the campaign was not created`,
    };
  }

  return {
    ok: true,
    broadcastId,
    recipients: recipients.length,
    unreachable: selection.unreachable.slice(0, 20),
    audience,
    scheduledFor: input.scheduledAt ?? null,
    template: templateName,
    queuedForScheduler: true,
  };
}

/** Phone numbers of a selection, de-duplicated — used by the Meta audience upload. */
export function phonesForUpload(leads: { phone?: string | null }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const lead of leads) {
    const digits = String(lead.phone ?? '').replace(/\D/g, '');
    if (!digits) continue;
    const normalised = normalisePhone(lead.phone);
    if (!normalised || seen.has(normalised)) continue;
    seen.add(normalised);
    out.push(digits);
  }
  return out;
}
