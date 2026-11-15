/**
 * The review gate: a tool that spends money or reaches a customer cannot run unreviewed.
 *
 * THE PROBLEM WITH "THE AGENT SHOULD ASK"
 * `request_human_approval` already exists and is good — it records a pending action, fires a
 * push notification, and renders a spec sheet with the cost. But it was a tool the model
 * COULD call, not a rule it HAD to. A model in a hurry, or one that misreads the request,
 * simply calls `generate_ai_image` or `meta_mcp_launch_leadgen_campaign` directly and the
 * money moves. Instructions in a prompt are not a gate.
 *
 * HOW THIS GATE WORKS
 *   1. `REVIEW_POLICY` names every tool that spends, reaches a customer, or destroys data,
 *      and what kind of approval it needs.
 *   2. `applyReviewGate` wraps those tools. Called without an approval, the tool does not
 *      run: it returns a structured `needs_review` result that contains the EXACT parameters
 *      to hand to `request_human_approval`.
 *   3. When the owner approves, `agent_events` holds a row with `status: 'approved'` and the
 *      `actionPayload` they saw. On the retry the gate compares a fingerprint of the tool's
 *      input against that payload. Equal → it runs. Different → it is refused, so approving
 *      "launch campaign A on ₹500/day" cannot authorise "launch campaign B on ₹5,000/day".
 *
 * WHY THE FINGERPRINT MATTERS MORE THAN THE ACTION TYPE
 * Matching only on "ad_spend" would let one approval authorise every ad spend for the rest
 * of the day. The owner approved a specific thing at a specific price; the gate holds them
 * to that and nothing more.
 *
 * The policy lives in code, not in a prompt, so a model cannot talk its way past it and a
 * future tool cannot be added to the dangerous set by accident and quietly stay open — the
 * gate fails CLOSED for any tool listed here and is tested for exactly that.
 */

export type ReviewActionType =
  | 'whatsapp_broadcast'
  | 'bulk_call'
  | 'delete_data'
  | 'ad_spend'
  | 'create_asset'
  | 'custom';

export interface ReviewPolicy {
  actionType: ReviewActionType;
  /** One sentence the owner reads: why this needs their eyes. */
  why: string;
}

/**
 * Everything that must be reviewed before it runs.
 *
 * Deliberately generous: a false positive costs one tap, a false negative costs money or
 * a message to a real customer. Anything that is free and reversible (planning, listing,
 * scraping a public page, creating a PAUSED flow) is intentionally NOT here.
 */
export const REVIEW_POLICY: Record<string, ReviewPolicy> = {
  // ── money in a vendor's hands
  generate_ai_image: { actionType: 'create_asset', why: 'each image costs credits' },
  generate_grok_video: { actionType: 'create_asset', why: 'video generation costs credits' },
  generate_voiceover: { actionType: 'create_asset', why: 'voice generation costs credits' },
  composeVideo: { actionType: 'create_asset', why: 'rendering a film costs credits and sandbox time' },
  composeCreative: { actionType: 'create_asset', why: 'composing a creative costs credits' },

  // ── the owner's ad budget
  meta_mcp_launch_leadgen_campaign: { actionType: 'ad_spend', why: 'it launches a campaign that spends real ad budget' },
  meta_mcp_create_campaign: { actionType: 'ad_spend', why: 'it creates a campaign that can start spending' },
  meta_graph_create: { actionType: 'ad_spend', why: 'it creates a Meta object that can spend budget' },
  meta_graph_set_status: { actionType: 'ad_spend', why: 'it can start or stop live spending' },
  meta_graph_update: { actionType: 'ad_spend', why: 'it can change a live campaign budget' },

  // ── reaching a real person
  nobogent_whatsapp_send_template: { actionType: 'whatsapp_broadcast', why: 'a real customer receives it' },
  nobogent_voice_dispatch_call: { actionType: 'bulk_call', why: 'a real customer is phoned and each call is billed' },
  publish_social_post: { actionType: 'whatsapp_broadcast', why: 'it publishes publicly in the business name' },
  site_publish_landing_page: { actionType: 'custom', why: 'it makes a page public in the business name' },

  // ── irreversible
  delete_data: { actionType: 'delete_data', why: 'deleting cannot be undone' },
};

/** Stable fingerprint of a tool's input, so "what you saw" can be compared to "what runs". */
export function approveFingerprint(input: unknown): string {
  const normalise = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalise);
    if (value && typeof value === 'object') {
      return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((out, key) => {
          out[key] = normalise((value as Record<string, unknown>)[key]);
          return out;
        }, {});
    }
    return value;
  };
  try {
    return JSON.stringify(normalise(input ?? {}));
  } catch {
    return String(input);
  }
}

/** The policy for a tool, or null when it may run freely. */
export function reviewPolicyFor(toolName: string): ReviewPolicy | null {
  return REVIEW_POLICY[toolName] ?? null;
}

/** What a blocked tool returns: an explanation plus exactly what to ask the owner. */
export interface ReviewBlocked {
  success: false;
  needs_review: true;
  actionType: ReviewActionType;
  why: string;
  /** Pass these to request_human_approval, verbatim. */
  call: {
    tool: 'request_human_approval';
    actionType: ReviewActionType;
    title: string;
    description: string;
    actionPayload: unknown;
  };
  message: string;
}

export function blockedResult(
  toolName: string,
  policy: ReviewPolicy,
  input: unknown,
): ReviewBlocked {
  return {
    success: false,
    needs_review: true,
    actionType: policy.actionType,
    why: policy.why,
    call: {
      tool: 'request_human_approval',
      actionType: policy.actionType,
      title: `Approve: ${toolName}`,
      description: `This step cannot run until it is approved, because ${policy.why}.`,
      // The exact payload the owner is being asked to approve, so the retry can be matched
      // against what they actually saw.
      actionPayload: input ?? {},
    },
    message:
      `"${toolName}" did not run: ${policy.why}. Call request_human_approval with the arguments ` +
      'in `call`, show the owner the spec and the cost, and only call this tool again after they ' +
      'approve — with the same arguments you asked about.',
  };
}

/** Where approvals are read from. Injected so the gate can be tested without a database. */
export interface ApprovalStore {
  /** Approved actions for this user, newest first. */
  approved(actionType: ReviewActionType): Promise<{ actionPayload: unknown }[]>;
}

/** `agent_events` rows written by `request_human_approval`, once the owner taps approve. */
export function supabaseApprovalStore(supabase: any, userId: string): ApprovalStore {
  return {
    async approved(actionType) {
      const { data, error } = await supabase
        .from('agent_events')
        .select('payload, status, created_at')
        .eq('user_id', userId)
        .eq('event_type', 'PENDING_ACTION_APPROVAL')
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .limit(25);
      if (error) return [];
      return (data ?? [])
        .map((row: any) => row?.payload ?? {})
        .filter((payload: any) => payload?.actionType === actionType)
        .map((payload: any) => ({ actionPayload: payload.actionPayload }));
    },
  };
}

/** True when an approved action matches this exact call. */
export async function isApproved(
  store: ApprovalStore,
  policy: ReviewPolicy,
  input: unknown,
): Promise<boolean> {
  const wanted = approveFingerprint(input);
  try {
    const approved = await store.approved(policy.actionType);
    return approved.some((entry) => approveFingerprint(entry.actionPayload) === wanted);
  } catch {
    // Fail CLOSED: if approvals cannot be read, nothing dangerous runs. A stuck button is
    // recoverable; an unreviewed launch is not.
    return false;
  }
}

/**
 * Wrap a tool map so the dangerous ones cannot run unreviewed.
 *
 * A tool not in `REVIEW_POLICY` is passed through untouched, so this adds no cost to the
 * cheap majority of the registry.
 */
export function applyReviewGate(
  tools: Record<string, any>,
  store: ApprovalStore,
): Record<string, any> {
  const gated: Record<string, any> = {};

  for (const [name, definition] of Object.entries(tools)) {
    const policy = reviewPolicyFor(name);
    if (!policy || typeof definition?.execute !== 'function') {
      gated[name] = definition;
      continue;
    }

    gated[name] = {
      ...definition,
      execute: async (input: any, ...rest: any[]) => {
        if (!(await isApproved(store, policy, input))) {
          return blockedResult(name, policy, input);
        }
        return definition.execute(input, ...rest);
      },
    };
  }

  return gated;
}
