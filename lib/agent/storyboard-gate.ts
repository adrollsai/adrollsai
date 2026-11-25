/**
 * Putting the storyboard in front of the owner, through the gate that already exists.
 *
 * `lib/agent/review-gate.ts` already knows how to record a pending approval and how to spend one
 * (`recordPending` / `consumeApproval`), and it already refuses to reuse an approval after the work
 * has run. What it needed was an artefact worth approving: a decision about a FILM, not about one
 * tool call.
 *
 * So a storyboard approval carries a fingerprint of the plan. It is approved once, for THAT plan:
 *
 *   - changing a timing or a headline changes the fingerprint, so an approval cannot silently
 *     authorise a different film;
 *   - rewording or re-rendering the sheet does not, because that is not a different film;
 *   - once the generation has run, the approval is consumed, so a loop cannot keep spending on one
 *     tap.
 *
 * Pure apart from the injected store, so this is testable without a database.
 */

import type { ApprovalStore, ReviewActionType } from './review-gate';
import { storyboardApprovalRequest, type Storyboard } from './storyboard';

/**
 * `create_asset` is the right member of the existing union: approving a storyboard authorises
 * creating the assets it describes.
 */
export const STORYBOARD_ACTION_TYPE: ReviewActionType = 'create_asset';

export interface StoryboardApprovalPayload {
  kind: 'storyboard';
  storyboardFingerprint: string;
  totalSeconds: number;
  beats: number;
  generatedBeats: number;
  attachmentBeats: number;
}

/** The payload a pending approval stores, and the only thing approval matching compares. */
export function approvalPayloadFor(storyboard: Storyboard): StoryboardApprovalPayload {
  return {
    kind: 'storyboard',
    storyboardFingerprint: storyboardApprovalRequest(storyboard).fingerprintPayload,
    totalSeconds: storyboard.totalSeconds,
    beats: storyboard.cards.length,
    generatedBeats: storyboard.generatedBeats,
    attachmentBeats: storyboard.attachmentBeats,
  };
}

/**
 * Pull a storyboard fingerprint out of whatever the store handed back.
 *
 * Rows written by different paths have held the payload in more than one shape, so this looks in
 * the obvious places rather than assuming one.
 */
export function fingerprintOfPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.storyboardFingerprint === 'string') return p.storyboardFingerprint;
  if (typeof p.fingerprintPayload === 'string') return p.fingerprintPayload;
  const nested = p.toolInput ?? p.input ?? p.arguments;
  if (nested && typeof nested === 'object') return fingerprintOfPayload(nested);
  return null;
}

export interface SubmitResult {
  actionId: string | null;
  /** The sheet the owner is shown. Always returned, even when the store is unavailable. */
  artefact: string;
  /** What the agent says while it waits. */
  message: string;
  /** True when nothing will be generated until this is approved. */
  blocked: true;
}

/**
 * Record the pending approval and return what to show.
 *
 * A store that cannot record (no database in a test, or `recordPending` absent) still yields the
 * artefact and the blocked message — the agent must never be able to proceed just because the
 * approval could not be filed. Failing closed is the whole point.
 */
export async function submitStoryboardApproval(args: {
  store: ApprovalStore | null;
  storyboard: Storyboard;
  title?: string;
  why?: string;
}): Promise<SubmitResult> {
  const request = storyboardApprovalRequest(args.storyboard);
  const payload = approvalPayloadFor(args.storyboard);

  let actionId: string | null = null;
  try {
    const recorded = await args.store?.recordPending?.({
      actionType: STORYBOARD_ACTION_TYPE,
      tool: 'plan_video_storyboard',
      toolInput: payload,
      title: args.title ?? `Approve storyboard — ${args.storyboard.totalSeconds.toFixed(1)}s, ${args.storyboard.cards.length} beats`,
      why:
        args.why ??
        'Nothing is generated until you approve this sheet. Approving costs nothing to change now; ' +
          'changing it after generation costs the credits for every shot that has to be re-made.',
    });
    actionId = recorded?.actionId ?? null;
  } catch {
    actionId = null;
  }

  return {
    actionId,
    artefact: request.artefact,
    blocked: true,
    message:
      actionId === null
        ? 'Storyboard ready. I cannot file the approval automatically, so nothing will be generated ' +
          'until you confirm this sheet. Reply "approved" to continue.'
        : 'Storyboard ready — approve it and I will start generating. Nothing is spent before that.',
  };
}

export interface ApprovalCheck {
  approved: boolean;
  actionId?: string;
  because: string;
}

/**
 * Is THIS plan approved?
 *
 * An approval for a different fingerprint does not count, which is what stops an old "yes" from
 * authorising an edited film.
 */
export async function isStoryboardApproved(args: {
  store: ApprovalStore | null;
  storyboard: Storyboard;
}): Promise<ApprovalCheck> {
  const wanted = approvalPayloadFor(args.storyboard).storyboardFingerprint;
  if (!args.store) {
    return { approved: false, because: 'no approval store is available, so nothing can be approved' };
  }

  let rows: { actionId?: string; actionPayload: unknown }[] = [];
  try {
    rows = await args.store.approved(STORYBOARD_ACTION_TYPE);
  } catch {
    return { approved: false, because: 'the approval store could not be read' };
  }

  for (const row of rows) {
    const stored = fingerprintOfPayload(row.actionPayload);
    if (stored && stored === wanted) {
      return {
        approved: true,
        actionId: row.actionId,
        because: 'this exact plan has been approved',
      };
    }
  }

  const otherPlans = rows.filter((r) => {
    const f = fingerprintOfPayload(r.actionPayload);
    return f && f !== wanted;
  }).length;

  return {
    approved: false,
    because:
      otherPlans > 0
        ? `there ${otherPlans === 1 ? 'is an approval' : 'are approvals'} for a DIFFERENT plan; this one ` +
          'has changed since, so it needs approving again'
        : 'this plan has not been approved yet',
  };
}

/**
 * Spend the approval.
 *
 * Called after the generation the approval authorised has run. An approval is a decision about one
 * film; leaving it live is how a loop keeps spending on a single tap.
 */
export async function consumeStoryboardApproval(args: {
  store: ApprovalStore | null;
  actionId: string | null;
}): Promise<void> {
  if (!args.store || !args.actionId) return;
  try {
    await args.store.consumeApproval?.(args.actionId);
  } catch {
    /* a failure to mark it spent must never fail the run that already succeeded */
  }
}
