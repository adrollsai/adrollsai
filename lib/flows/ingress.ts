import type { SupabaseClient } from '@supabase/supabase-js';
import { startFlowRun, storedTrigger, type StartResult } from './start';
import { identityKey, type FlowIdentity } from './conflicts';

/**
 * The event → flow bridge that did not exist.
 *
 * `startFlowRun` has been callable since the scheduler landed, but only a probe script called it.
 * Nothing in the product turned a real event into a flow run: the inbound WhatsApp webhook stored
 * the message, replied with a bot, and stopped. So every flow on every account was a saved diagram.
 *
 * This module is that bridge, and it is deliberately small and total:
 *
 *   match  — pure: does this stored flow listen for this event? No database, no network.
 *   fire   — find the active flows that match, then start a run for each.
 *
 * It QUEUES ONLY. A started flow writes ledger rows; the clock picks them up, and a human approves
 * each step before anything reaches a customer. Starting a flow is therefore safe to do on the
 * inbound path, which is exactly why it belongs there.
 *
 * The one structural rule kept from the builder: two flows on the same trigger key would message the
 * same person twice. When legacy data contains such a pair, the OLDEST flow wins and the others are
 * reported — silently firing both is the failure this rule exists to prevent.
 */

export interface FlowTriggerEvent {
  userId: string;
  /** One of TRIGGER_CAPABILITIES' keys. */
  trigger: string;
  leadId: string;
  /** The message text, for keyword matching. */
  text?: string | null;
  /** The template/quick-reply id, for a button trigger. */
  buttonId?: string | null;
  /**
   * Which campaign this lead came from, when the platform knows — the ad campaign id, the source
   * id, whatever identifies it. A sequence scoped to "the campaign I just launched" needs this, and
   * without it every campaign's leads would trigger it.
   */
  campaignId?: string | null;
  /** The event's own moment (an appointment), for steps timed against it. */
  anchorAt?: Date | string | null;
  /** Which run this is; derived from the event so a replay cannot start a second run. */
  runKey?: string | null;
  now?: Date;
}

export interface MatchVerdict {
  matches: boolean;
  why: string;
}

function keywordList(keywords: string[], keyword: string | null): string[] {
  const list = [...keywords];
  if (keyword) list.push(keyword);
  return list.map((k) => k.trim().toLowerCase()).filter(Boolean);
}

/**
 * Does this stored flow listen for this event?
 *
 * Rules, in order, each with a reason a person can read:
 *   - the flow must record the trigger, or the event must be the thing firing it;
 *   - a keyword trigger only matches when one of its keywords appears in the message;
 *   - a button trigger only matches when the button id matches (a different button is a different
 *     event, the same way a different template is).
 */
export function matchesFlowTrigger(
  stored: { trigger: ReturnType<typeof storedTrigger> },
  event: Pick<FlowTriggerEvent, 'trigger' | 'text' | 'buttonId' | 'campaignId'>
): MatchVerdict {
  const trigger = stored.trigger;
  if (!trigger) return { matches: false, why: 'the flow records no trigger, so only an event can start it' };
  if (trigger.type !== event.trigger) {
    return { matches: false, why: `this flow listens on ${trigger.type}, not ${event.trigger}` };
  }

  /**
   * A campaign-scoped sequence listens to ONE campaign, not to every lead the account ever gets.
   *
   * This matters more than it looks: an owner who says "when a lead comes from the campaign I just
   * launched" is usually running several campaigns, and a sequence that fires on all of them would
   * message people who never saw it — with a template that mentions the wrong offer.
   */
  if (trigger.campaignId) {
    const wanted = String(trigger.campaignId).trim().toLowerCase();
    const got = String(event.campaignId ?? '').trim().toLowerCase();
    if (!got) {
      return { matches: false, why: `it only listens to campaign ${trigger.campaignId}, and this lead names no campaign` };
    }
    if (got !== wanted) {
      return { matches: false, why: `it only listens to campaign ${trigger.campaignId}, and this lead came from ${event.campaignId}` };
    }
  }

  const keywords = keywordList(trigger.keywords, trigger.keyword);
  if (keywords.length) {
    const haystack = String(event.text ?? '').toLowerCase();
    const hit = keywords.find((k) => haystack.includes(k));
    if (!hit) {
      return { matches: false, why: `it only answers messages containing ${keywords.join(', ')}` };
    }
  }

  if (trigger.buttonId) {
    if (!event.buttonId) return { matches: false, why: `it waits for the button "${trigger.buttonId}", and this event has none` };
    if (trigger.buttonId !== event.buttonId) {
      return { matches: false, why: `it waits for the button "${trigger.buttonId}", and this was "${event.buttonId}"` };
    }
  }

  return { matches: true, why: keywords.length ? `matched keyword in the message` : 'trigger matches' };
}

export interface StartedFlow {
  flowId: string;
  title: string;
  queued: number;
  firstRunAt?: string;
  runKey: string;
  triggerType: string | null;
  note?: string;
}

export interface SkippedFlow {
  flowId: string;
  title: string;
  why: string;
}

export interface FireResult {
  fired: boolean;
  started: StartedFlow[];
  skipped: SkippedFlow[];
}

/**
 * Start every active flow that listens for this event.
 *
 * Never throws: the caller is a webhook whose job is to acknowledge Meta quickly, and a flow that
 * cannot start must not fail the message. Every skip is reported with its reason so "nothing
 * happened" is always explainable.
 */
export async function fireFlowTrigger(supabase: SupabaseClient, event: FlowTriggerEvent): Promise<FireResult> {
  const result: FireResult = { fired: false, started: [], skipped: [] };

  const { data: flows, error } = await supabase
    .from('automations')
    .select('id, title, description, is_active, created_at')
    .eq('user_id', event.userId)
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) {
    result.skipped.push({ flowId: '-', title: '-', why: `could not read this account's flows: ${error.message}` });
    return result;
  }

  // Only active flows. A paused flow is a decision its owner made, not an error.
  const candidates = (flows ?? []).filter((f: any) => f.is_active !== false);

  /**
   * A campaign-scoped sequence needs to know which campaign this lead came from, and most webhook
   * callers do not pass it. Rather than change every one of them (and forget the next one), the
   * campaign is read from the lead — once, and only when some flow actually filters on it.
   */
  let campaignId = event.campaignId ?? null;
  if (!campaignId) {
    const needsCampaign = candidates.some((f: any) => storedTrigger(f.description)?.campaignId);
    if (needsCampaign) {
      const { data: lead } = await supabase
        .from('leads')
        .select('campaign_id')
        .eq('id', event.leadId)
        .maybeSingle();
      campaignId = (lead as any)?.campaign_id ?? null;
    }
  }
  const matchEvent = { ...event, campaignId };

  // One flow per trigger key: the oldest wins, the rest are reported rather than also fired.
  const claimed = new Map<string, string>();

  for (const flow of candidates) {
    const id = String(flow.id);
    const title = String(flow.title ?? id);
    const trigger = storedTrigger(flow.description);

    const verdict = matchesFlowTrigger({ trigger }, matchEvent);
    if (!verdict.matches) {
      // Only report flows that listen on this trigger but were filtered out; the rest are noise.
      if (trigger?.type === event.trigger) {
        result.skipped.push({ flowId: id, title, why: verdict.why });
      }
      continue;
    }

    const identity: FlowIdentity = {
      id,
      name: title,
      triggerType: trigger!.type,
      triggerKey: trigger!.templateName,
    };
    const key = identityKey(identity);
    const alreadyClaimed = claimed.get(key);
    if (alreadyClaimed) {
      result.skipped.push({
        flowId: id,
        title,
        why: `"${alreadyClaimed}" already listens on ${key}, and two flows on one trigger would message the same person twice`,
      });
      continue;
    }
    claimed.set(key, title);

    try {
      const started: StartResult = await startFlowRun(supabase, {
        userId: event.userId,
        flowId: id,
        leadId: event.leadId,
        description: flow.description,
        now: event.now,
        triggerType: event.trigger,
        runKey: event.runKey ?? `once`,
        anchorAt: event.anchorAt ?? null,
      });

      if (!started.ok) {
        result.skipped.push({ flowId: id, title, why: started.blockers.join(' ') || 'the run was refused' });
        continue;
      }

      result.started.push({
        flowId: id,
        title,
        queued: started.queued,
        firstRunAt: started.firstRunAt,
        runKey: started.runKey ?? 'once',
        triggerType: started.triggerType ?? null,
        note: started.reason === 'already_queued' ? 'this run was already queued, so nothing new was written' : undefined,
      });
      result.fired = true;
    } catch (error: any) {
      result.skipped.push({ flowId: id, title, why: `could not queue the run: ${String(error?.message || error)}` });
    }
  }

  return result;
}

/**
 * Which trigger an inbound WhatsApp message is, in the vocabulary capabilities.ts speaks.
 *
 * A tapped template button is not an ordinary message: it fires `trigger_whatsapp_template_button`
 * and needs the button id. A message that arrived from a click-to-WhatsApp ad fires
 * `trigger_whatsapp_ctwa`. Everything else is a plain inbound message.
 */
export function inboundTriggerFor(input: { isFromAd?: boolean; buttonId?: string | null }): string {
  if (input.buttonId) return 'trigger_whatsapp_template_button';
  if (input.isFromAd) return 'trigger_whatsapp_ctwa';
  return 'trigger_whatsapp_inbound';
}
