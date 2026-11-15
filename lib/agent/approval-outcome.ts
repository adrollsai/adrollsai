/**
 * What "approved" means, and what the API is allowed to say about it.
 *
 * THE BUG THIS REPLACES
 * POST /api/agent/v2/action used to answer an approval with invented execution results:
 *
 *   whatsapp_broadcast -> "Successfully launched WhatsApp broadcast to 400 leads."
 *   bulk_call          -> "Queued 400 leads for autonomous voice followup."
 *   anything else      -> "Custom action executed successfully."
 *
 * None of it was true. No broadcast was dispatched, no call was queued, and nothing at all
 * happened for an ad spend — the route only flipped a row's status and wrote a sentence. Two
 * ways to be wrong, both bad: an owner is told a message reached 400 real people when it did
 * not, and — for the one action type that spends money — the app reports a launch that never
 * occurred. A user who checks finds the lie and stops trusting every other number.
 *
 * WHAT APPROVING ACTUALLY DOES
 * It unlocks the review gate: the event is marked `approved`, the client puts the staged
 * instruction back into the conversation, and the AGENT performs the work with its real tools.
 * The gate then matches the tool call's arguments against the payload the owner saw, so the
 * work that runs is exactly the work that was approved. The route's honest answer is therefore
 * "approved, the agent continues" — never "done".
 *
 * The same rule everywhere: this module cannot express "already executed", so no future action
 * type can grow a fabricated success message without editing this file and its gate.
 */

export type ApprovalStatus = 'approved' | 'rejected';

export interface ApprovalOutcome {
  /** The row's new status. Never 'completed' — the agent has not done the work yet. */
  status: 'approved';
  /** The client resumes the conversation with the staged instruction. */
  resumed: true;
  /** True only if the work is finished. Structurally impossible here, on purpose. */
  executed: false;
  /** What to tell the owner. Stated in terms of what happens NEXT, not what already happened. */
  message: string;
}

/** What the caller is told after a human approves. */
export function approvalOutcome(actionType: string): ApprovalOutcome {
  const what = describeAction(actionType);
  return {
    status: 'approved',
    resumed: true,
    executed: false,
    message: `Approved. The agent is continuing with the ${what} in the chat now — nothing had ` +
      'been sent before this, and the work runs with the same details you just approved.',
  };
}

/** What the caller is told after a human declines. */
export function rejectionOutcome(): { status: 'rejected'; message: string } {
  return {
    status: 'rejected',
    message: 'Cancelled. Nothing was sent, nothing was spent, and the agent will not retry it on its own.',
  };
}

/** Plain words for the thing the owner approved. */
export function describeAction(actionType: string): string {
  switch (actionType) {
    case 'whatsapp_broadcast':
      return 'WhatsApp message';
    case 'bulk_call':
      return 'batch of calls';
    case 'ad_spend':
      return 'ad campaign';
    case 'create_asset':
      return 'creative';
    case 'delete_data':
      return 'deletion';
    default:
      return 'action';
  }
}

/**
 * Words that claim work already happened. The route's responses are checked against this so a
 * fabricated success sentence cannot creep back in.
 */
export const FORBIDDEN_CLAIM_PATTERNS: readonly RegExp[] = [
  /successfully (launched|sent|dispatched|executed|queued)/i,
  /has been (sent|launched|dispatched|executed)/i,
  /executed successfully/i,
  /\b(sent|delivered) to \d+/i,
  /\bqueued\b[^.]{0,40}\bleads?\b/i,
];

/** Does this text claim the action already ran? */
export function claimsExecution(text: string): boolean {
  return FORBIDDEN_CLAIM_PATTERNS.some((pattern) => pattern.test(String(text ?? '')));
}
