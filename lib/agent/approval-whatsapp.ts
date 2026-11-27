import type { SupabaseClient } from '@supabase/supabase-js';
import { enqueueRun } from './harness/runs';
import { ensurePeriodSession, periodLabel } from './routines';

/**
 * Approve / skip / change — from WhatsApp.
 *
 * The approval card already works in the app. This gives the owner the same three
 * verbs on their phone, because that is where they actually are when the CEO asks.
 * WhatsApp is a doorbell, never the record: everything still resolves against the
 * pending event in `agent_events`, and the work happens in that day's thread.
 *
 * The WhatsApp and push helpers are imported lazily: both create a Supabase client at
 * module scope, so a static import drags env requirements into every module that only
 * wanted to parse a reply.
 */

async function reply(phone: string, text: string) {
  try {
    const { sendNobogentTextMessage } = await import('@/utils/creative-approval-handler');
    await sendNobogentTextMessage(phone, text);
  } catch (e) {
    console.warn('[AgentApproval] WhatsApp reply not delivered:', (e as any)?.message || e);
  }
}

async function push(userId: string, title: string, body: string) {
  try {
    const { sendPushNotification } = await import('@/utils/notification-helper');
    await sendPushNotification(userId, title, body, '/dashboard/ceo');
  } catch (e) {
    console.warn('[AgentApproval] push not delivered:', (e as any)?.message || e);
  }
}

const APPROVE = /^(approve|approved|yes|ok|okay|haan|ha|theek hai|thik hai|done|go ahead|approved ✅)$/i;
const SKIP = /^(skip|no|cancel|not now|nahi|nah|reject|band karo|stop)$/i;

export type ApprovalReplyKind = 'approved' | 'skipped' | 'edit' | 'none';

export interface ApprovalReplyResult {
  kind: ApprovalReplyKind;
  approvalTitle?: string;
  /** For 'edit': the owner's own words, ready to hand to the agent. */
  instruction?: string;
  message?: string;
}

/** Last 10 digits are what people actually type, and what survives +91 / spaces. */
export function phoneTail(raw: string | null | undefined): string {
  return String(raw || '').replace(/\D/g, '').slice(-10);
}

export async function pendingApprovalsForPhone(
  supabase: SupabaseClient,
  phone: string
): Promise<{ userId: string | null; approvals: any[] }> {
  const tail = phoneTail(phone);
  if (!tail) return { userId: null, approvals: [] };

  // Numbers are stored as typed ("+91 98726 69935"), so a plain string match never
  // finds them. `profiles.whatsapp_digits_rev` is a generated column holding the digits
  // reversed, which turns "ends with these 10 digits" into an indexed prefix search.
  const reversed = tail.split('').reverse().join('');
  let candidates: any[] = [];
  const byDigits = await supabase
    .from('profiles')
    .select('id, whatsapp_phone_number, contact_number')
    .or(`whatsapp_digits_rev.like.${reversed}%,contact_digits_rev.like.${reversed}%`)
    .limit(5);

  if (!byDigits.error) {
    candidates = byDigits.data || [];
  } else {
    // Column not migrated yet: fall back to a broader scan, still verified in JS.
    const loose = await supabase
      .from('profiles')
      .select('id, whatsapp_phone_number, contact_number')
      .not('whatsapp_phone_number', 'is', null)
      .limit(2000);
    candidates = loose.data || [];
  }

  const owner = candidates.find(
    (p: any) => phoneTail(p.whatsapp_phone_number) === tail || phoneTail(p.contact_number) === tail
  );
  if (!owner?.id) return { userId: null, approvals: [] };

  const { data: events } = await supabase
    .from('agent_events')
    .select('id, payload, created_at')
    .eq('user_id', owner.id)
    .eq('event_type', 'PENDING_ACTION_APPROVAL')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1);

  return { userId: owner.id, approvals: events || [] };
}

/**
 * Resolve one inbound WhatsApp message against the owner's newest pending approval.
 *
 * Anything that is not an obvious approve/skip is treated as a change request: the
 * owner typed words, so words are what the agent gets.
 */
export async function resolveApprovalReply(
  supabase: SupabaseClient,
  phone: string,
  text: string
): Promise<ApprovalReplyResult> {
  const clean = String(text || '').trim();
  if (!clean) return { kind: 'none' };

  const { userId, approvals } = await pendingApprovalsForPhone(supabase, phone);
  if (!userId) return { kind: 'none' };
  const event = approvals[0];
  if (!event) return { kind: 'none' };

  const payload = event.payload || {};
  const title = payload.title || 'your approval';
  const resumePrompt =
    payload.resumePrompt ||
    `Approved — continue with the staged plan: ${payload.description || title}`;

  // A bare thumbs-up or a word, not a sentence: unambiguous.
  const isApprove = APPROVE.test(clean);
  const isSkip = SKIP.test(clean);

  if (isApprove) {
    await supabase
      .from('agent_events')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('id', event.id);

    const sessionId = await ensurePeriodSession(
      supabase,
      userId,
      periodLabel(new Date(), 'Asia/Kolkata')
    );
    const run = await enqueueRun(supabase, {
      sessionId,
      userId,
      goal: resumePrompt,
      priority: 8,
    });

    void reply(phone, `✅ Approved — "${title}". Working on it now.`);
    void push(userId, 'Approved from WhatsApp', title);
    return {
      kind: 'approved',
      approvalTitle: title,
      message: `Approved — ${run ? 'run queued' : 'no run could be queued'}`,
    };
  }

  if (isSkip) {
    await supabase
      .from('agent_events')
      .update({ status: 'rejected', updated_at: new Date().toISOString() })
      .eq('id', event.id);
    void reply(phone, `⏭️ Skipped — "${title}". Nothing was generated.`);
    return { kind: 'skipped', approvalTitle: title };
  }

  // Long replies are changes; short ones that are not approve/skip are ambiguous, and
  // guessing wrong costs money, so ask once instead of acting.
  if (clean.split(/\s+/).length < 3) {
    void reply(
      phone,
      `For "${title}" reply APPROVE, SKIP, or describe the change you want (for example: "headline shorter, no price").`
    );
    return { kind: 'none', approvalTitle: title };
  }

  const sessionId = await ensurePeriodSession(supabase, userId, periodLabel(new Date(), 'Asia/Kolkata'));
  await enqueueRun(supabase, {
    sessionId,
    userId,
    goal:
      `The owner replied on WhatsApp about the pending approval "${title}":\n"${clean}"\n\n` +
      'Apply exactly that change to the staged work, keep everything else the same, and bring it back for approval once. ' +
      'Do not start from scratch and do not generate anything expensive before the approval.',
    priority: 8,
  });
  void reply(phone, `✏️ Got it — revising "${title}" with your change.`);
  return { kind: 'edit', approvalTitle: title, instruction: clean };
}

