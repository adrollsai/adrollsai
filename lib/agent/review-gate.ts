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

import { z } from 'zod';

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
  build_website: { actionType: 'custom', why: 'it publishes a public website in the business name' },

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
  /** Approved actions for this user, newest first. The full event payload, so the gate can
   *  both compare arguments and re-run the approved one verbatim. */
  approved(actionType: ReviewActionType): Promise<ApprovedAction[]>;
  /**
   * Record a pending approval for a call the gate just refused, using the EXACT arguments it
   * refused. Optional so the gate still works (and is still testable) without a database.
   */
  recordPending?(request: {
    actionType: ReviewActionType;
    tool: string;
    toolInput: unknown;
    title: string;
    why: string;
  }): Promise<{ actionId: string } | null>;
  /**
   * Spend an approval once its work has run.
   *
   * Approvals used to stay valid forever, which meant an approval the owner gave for one image
   * kept authorising that identical call on every later attempt — including in a loop. An
   * approval is a decision about ONE action; once it has been carried out, it is used up.
   */
  consumeApproval?(actionId: string): Promise<void>;
}

export interface ApprovedAction {
  /** Absent on rows written before this field was stored; fingerprint matching still works. */
  actionId?: string;
  actionPayload: unknown;
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
        .map((payload: any) => ({
          actionId: typeof payload?.actionId === 'string' ? payload.actionId : undefined,
          actionPayload: payload?.actionPayload,
        }));
    },

    /**
     * The gate writes the pending approval itself, so the payload the owner approves is the
     * tool's real arguments rather than the model's summary of them.
     *
     * This is what makes "approve, then it runs" work. When the model staged the card through
     * `request_human_approval`, it described the call in its own words — `{brief, facts}` where
     * `generate_ai_image` needs `{prompt}` — so the approved payload could not be executed at
     * all, and the faithful attempt returned "prompt is required." The gate is the only code
     * that holds the exact arguments, so it is the only code that can record them.
     */
    /**
     * Mark the approval used. The row moves to `used`, which the store's own `approved()` query
     * no longer returns — so the same approval cannot authorise a second run.
     */
    async consumeApproval(actionId) {
      try {
        await supabase
          .from('agent_events')
          .update({ status: 'used', updated_at: new Date().toISOString() })
          .eq('user_id', userId)
          .eq('event_type', 'PENDING_ACTION_APPROVAL')
          .eq('payload->>actionId', actionId);
      } catch (error: any) {
        console.warn('[Review gate] could not mark the approval used:', error?.message || error);
      }
    },

    async recordPending({ actionType, tool, toolInput, title, why }) {
      try {
        const actionId = 'act_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-6);
        const { error } = await supabase.from('agent_events').insert({
          user_id: userId,
          event_type: 'PENDING_ACTION_APPROVAL',
          status: 'pending',
          scheduled_for: new Date().toISOString(),
          payload: {
            actionId,
            actionType,
            title,
            description: `This step cannot run until it is approved, because ${why}.`,
            targetTool: tool,
            // The exact arguments the tool was called with — not a description of them.
            actionPayload: toolInput ?? {},
            resumePrompt: '',
          },
        });
        if (error) {
          console.warn('[Review gate] could not record the pending approval:', error.message);
          return null;
        }
        return { actionId };
      } catch (error: any) {
        console.warn('[Review gate] could not record the pending approval:', error?.message || error);
        return null;
      }
    },
  };
}

export interface ApprovalMatch {
  /** How the call was authorised. */
  via: 'fingerprint' | 'approvalId';
  /** The payload the owner actually approved — what should be run. */
  actionPayload: unknown;
  /** Which approval this was, so it can be spent. */
  actionId?: string;
}

/**
 * Find the approval that authorises this call, if any.
 *
 * TWO WAYS TO MATCH, and the second one exists because the first is not enough in practice:
 *
 *   fingerprint — the args are identical to what the owner saw (normalised for key order).
 *                 Correct, but it asks the MODEL to reproduce its own prose byte for byte. In
 *                 production it never did: every retry re-worded the image prompt, so the gate
 *                 kept refusing work the owner had just approved, and the flagship journey
 *                 ("approve, then it runs") failed at the last step.
 *
 *   approvalId  — the agent passes the id of an approved action and the gate runs THAT payload
 *                 instead of the caller's arguments. The owner approved specific work; this runs
 *                 exactly it. Nothing about the budget can change, because the stored payload is
 *                 what was displayed when they tapped approve.
 *
 * Both paths are scoped to an approved row of the same action type, and a store failure still
 * fails CLOSED.
 */
export async function findApproval(
  store: ApprovalStore,
  policy: ReviewPolicy,
  input: unknown,
): Promise<ApprovalMatch | null> {
  const wanted = approveFingerprint(input);
  const requestedId =
    input && typeof input === 'object' && typeof (input as any).approvalId === 'string'
      ? (input as any).approvalId
      : null;

  try {
    const approved = await store.approved(policy.actionType);

    if (requestedId) {
      const byId = approved.find((entry) => entry.actionId === requestedId);
      if (byId) return { via: 'approvalId', actionPayload: byId.actionPayload, actionId: byId.actionId };
      // An id was given that is not approved: refuse. Never fall back to running the caller's
      // arguments on the strength of some other approval.
      return null;
    }

    const byFingerprint = approved.find((entry) => approveFingerprint(entry.actionPayload) === wanted);
    if (byFingerprint)
      return { via: 'fingerprint', actionPayload: byFingerprint.actionPayload, actionId: byFingerprint.actionId };

    return null;
  } catch {
    // Fail CLOSED: if approvals cannot be read, nothing dangerous runs. A stuck button is
    // recoverable; an unreviewed launch is not.
    return null;
  }
}

/** True when an approved action matches this exact call. */
export async function isApproved(
  store: ApprovalStore,
  policy: ReviewPolicy,
  input: unknown,
): Promise<boolean> {
  return (await findApproval(store, policy, input)) !== null;
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
      // The approval id has to survive schema validation to reach execute, so every gated tool
      // gains the one optional field. Zod strips unknown keys, which is exactly how the first
      // attempt at this failed silently.
      inputSchema: withApprovalId(definition.inputSchema),
      execute: async (input: any, ...rest: any[]) => {
        const match = await findApproval(store, policy, input);
        if (!match) {
          const cleanInput = stripApprovalId(input);

          // Record the approval here, with these exact arguments, and hand the chat a card it
          // can render directly. Nothing is left to the model to transcribe.
          const recorded = store.recordPending
            ? await store.recordPending({
                actionType: policy.actionType,
                tool: name,
                toolInput: cleanInput,
                title: `Approve: ${name}`,
                why: policy.why,
              })
            : null;

          const blocked = blockedResult(name, policy, cleanInput);

          if (recorded?.actionId) {
            return {
              ...blocked,
              actionId: recorded.actionId,
              requiresApproval: true,
              actionPayload: {
                actionType: policy.actionType,
                title: `Approve: ${name}`,
                description: policy.why,
              },
              artifact: {
                type: 'action_confirmation',
                actionId: recorded.actionId,
                actionType: policy.actionType,
                title: `Approve: ${name}`,
                description: `This step cannot run until it is approved, because ${policy.why}.`,
                status: 'pending',
                payload: cleanInput,
              },
              message:
                `"${name}" did not run: ${policy.why}. The approval card (${recorded.actionId}) is ` +
                'already on the owner\'s screen with the exact arguments — do NOT call ' +
                'request_human_approval for this step, and do not restate the arguments. Tell the ' +
                'owner what you have staged and that one tap on the card lets it run.',
            };
          }

          return {
            ...blocked,
            message:
              `${blocked.message} If the owner has ALREADY approved this exact step, call "${name}" ` +
              'again with its `approvalId` and do not re-type the arguments — the approved version ' +
              'is what runs.',
          };
        }
        // Run the approved payload, not the caller's restatement of it.
        const payload =
          match.via === 'approvalId' ? match.actionPayload : stripApprovalId(input);
        const result = await definition.execute(payload, ...rest);

        // Spend the approval: one approval authorises one run, not every future attempt with
        // the same arguments.
        if (match.actionId && store.consumeApproval) {
          await store.consumeApproval(match.actionId);
        }

        return result;
      },
    };
  }

  return gated;
}

/** Remove the gate's own bookkeeping field before a tool sees its arguments. */
export function stripApprovalId(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const { approvalId, ...rest } = input as Record<string, unknown>;
  void approvalId;
  return rest;
}

/** Add the optional `approvalId` to a tool's schema, when the schema can take it. */
function withApprovalId(schema: any): any {
  if (!schema || typeof schema.extend !== 'function') return schema;
  try {
    return schema.extend({ approvalId: approvalIdSchema() });
  } catch {
    // A schema that cannot be extended (refined, union, transformed) keeps its own shape; the
    // fingerprint path still authorises those tools.
    return schema;
  }
}

/**
 * The one field the gate adds to every dangerous tool.
 *
 * It has to be IN the schema, not merely read off the input: the AI SDK validates arguments
 * against `inputSchema` and Zod strips unknown keys, so an unlisted `approvalId` would be
 * dropped before `execute` ever saw it. That silent strip is the difference between the
 * approval path working and failing without a trace.
 */
function approvalIdSchema(): any {
  // Static import: the file is server-only, and a lazy require splits the zod instance in some
  // bundlers, which would make `extend` fail at runtime.
  return z
    .string()
    .optional()
    .describe(
      'The approvalId of a step the owner has ALREADY approved. When you pass it, the exact ' +
        'approved arguments are used and any other argument you supply is ignored — so do not ' +
        're-type the payload.',
    );
}
