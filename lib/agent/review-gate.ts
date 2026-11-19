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
  /**
   * Optional condition on the CALL. When it returns false the call runs ungated.
   *
   * Needed because "may this run?" is not always a property of the tool: rendering a cheap draft for the
   * agent's own checking loop should be free, while the DELIVERY render — the file the owner actually
   * posts — is exactly the thing that should need a human look first. Gating the tool wholesale would
   * make the agent ask permission to check its own work.
   */
  when?: (input: any) => boolean;
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
  // THE DELIVERY RENDER, NOT EVERY RENDER.
  //
  // A draft render is how the agent checks its own work — its compositing loop, its frame reviews — and
  // gating that would mean asking permission to look at its own output. The DELIVERY render is the file
  // the owner posts, and that is the one a human should see first. This is also what lets the flow be:
  // storyboard and drafts first, approval, then the final encode.
  sandbox_render_hyperframes: {
    actionType: 'create_asset',
    why: 'it produces the final video file the owner will publish',
    when: (input: any) => String(input?.quality ?? '').trim().toLowerCase() === 'delivery',
  },

  // ── the owner's ad budget
  meta_mcp_launch_leadgen_campaign: { actionType: 'ad_spend', why: 'it launches a campaign that spends real ad budget' },
  meta_mcp_create_campaign: { actionType: 'ad_spend', why: 'it creates a campaign that can start spending' },
  meta_graph_create: { actionType: 'ad_spend', why: 'it creates a Meta object that can spend budget' },
  meta_graph_set_status: { actionType: 'ad_spend', why: 'it can start or stop live spending' },
  meta_graph_update: { actionType: 'ad_spend', why: 'it can change a live campaign budget' },

  // THE TWO ESCAPE HATCHES.
  //
  // Gating the named tools is not enough when a generic passthrough can do the same work under a
  // different name — a gate you can walk around is a gate that only stops the honest path.
  //   meta_graph_query      takes a raw method and path: GET is a read, POST/DELETE is the whole
  //                         ad account.
  //   meta_official_call_tool calls ANY tool on Meta's official ads MCP server, so its blast radius
  //                         is whatever the owner's token can reach.
  // So these are gated by what the call WOULD do, not by the tool's name.
  meta_graph_query: {
    actionType: 'ad_spend',
    why: 'this writes to the ad account through the raw Graph escape hatch',
    when: (input: any) => String(input?.method ?? 'GET').trim().toUpperCase() !== 'GET',
  },
  meta_official_call_tool: {
    actionType: 'ad_spend',
    why: 'that Meta MCP tool can change the ad account, and only reads run unreviewed',
    when: (input: any) => !isReadOnlyMetaTool(String(input?.toolName ?? '')),
  },

  // ── reaching a real person
  nobogent_whatsapp_send_template: { actionType: 'whatsapp_broadcast', why: 'a real customer receives it' },
  nobogent_voice_dispatch_call: { actionType: 'bulk_call', why: 'a real customer is phoned and each call is billed' },
  publish_social_post: { actionType: 'whatsapp_broadcast', why: 'it publishes publicly in the business name' },
  site_publish_landing_page: { actionType: 'custom', why: 'it makes a page public in the business name' },
  build_website: { actionType: 'custom', why: 'it publishes a public website in the business name' },
  // `landing_pages` has no draft/status column, so a page is reachable at its slug the instant the row
  // exists. Creating one is therefore just as public as publishing one, and it was the only page tool
  // NOT behind this gate: the prompt claimed "creating a page stages it", and it did not stage anything.
  create_landing_page: { actionType: 'custom', why: 'the page is live at its slug the moment it is created' },

  // ── irreversible
  delete_data: { actionType: 'delete_data', why: 'deleting cannot be undone' },

  // ── the machinery, reached through the sandbox or a raw database handle
  //
  // These exist for super-admin debugging. In production one owner asked for a
  // call recording, the agent could not find one, and it went looking INSIDE the
  // infrastructure to fetch the file itself: `env | grep` for supabase / R2 / API
  // keys, a raw curl at the REST endpoint, twenty guesses at table names, and a
  // read of the deployment's environment variables. Nothing leaked — the values
  // were masked and it was the owner's own account — but an agent should never go
  // hunting for credentials to satisfy a data request.
  //
  // `sandbox_bash_run` is NOT gated wholesale: the media and video skills run
  // ffmpeg and friends through it every day, and asking permission for each of
  // those would break the work rather than protect it. The condition below gates
  // only the commands that are after secrets.
  sandbox_bash_run: {
    actionType: 'custom',
    why: 'this command reads credentials or the environment',
    when: (input: any) => looksLikeSecretProbe(String(input?.command ?? '')),
  },
  sandbox_write_file: {
    actionType: 'custom',
    why: 'this writes a file that looks like it holds credentials',
    when: (input: any) =>
      /(^|\/)\.env(\.|$)|credentials|service_role|id_rsa|\.pem$/i.test(String(input?.path ?? '')),
  },
  supabase_mcp_inspect_table: {
    actionType: 'custom',
    why: 'it reads rows straight out of the database, outside the product’s own reporting',
  },
  vercel_mcp_list_env_vars: {
    actionType: 'custom',
    why: 'it reads the deployment’s environment variables',
  },
};

/**
 * Does this shell command look like it is chasing secrets?
 *
 * Deliberately narrow. A false positive costs one approval tap on a legitimate
 * debugging command; a false negative hands the agent the keys.
 */
export function looksLikeSecretProbe(command: string): boolean {
  const cmd = String(command || '').toLowerCase();
  if (!cmd.trim()) return false;
  // Reading the environment, or grepping it for credential-shaped words.
  if (/(^|[|;&(\s])(env|printenv|set|export)\s*($|[|;&)])/.test(cmd)) return true;
  if (/(^|[|;&(\s])env$/.test(cmd.trim())) return true;
  if (/\/proc\/self\/environ|\.env\b/.test(cmd)) return true;
  // Looking for key/token/secret material by name.
  const secretWord = /(secret|token|api[_-]?key|apikey|password|passwd|credential|service[_-]?role|private[_-]?key|access[_-]?key)/;
  const readerish = /\b(grep|cat|head|tail|printenv|echo|awk|sed|strings|less|more|jq)\b/;
  return secretWord.test(cmd) && readerish.test(cmd);
}

/**
 * Is this Meta MCP tool name a READ?
 *
 * The official ads MCP server exposes dozens of tools and their names are the only thing we can
 * judge before the call: `ads_get_ad_accounts`, `ads_get_campaigns`, `ads_insights_*` are reads;
 * `ads_create_campaign`, `ads_update_adset`, `ads_activate_*` are not.
 *
 * Reads run freely — an agent that needs a permission for every report is useless. Anything that
 * names a mutation is gated, and so is anything ambiguous: an unknown name is treated as a write,
 * because guessing "probably a read" is how a budget gets spent.
 */
export function isReadOnlyMetaTool(toolName: string): boolean {
  const name = String(toolName || '').trim().toLowerCase();
  if (!name) return false;
  // A write verb anywhere in the name settles it, whatever the prefix says.
  if (/(create|update|delete|remove|pause|unpause|activate|deactivate|enable|disable|launch|publish|promote|boost|duplicate|archive|add|edit|set_?|upload|schedule|budget|bid|spend|invite|grant)/.test(name)) {
    return false;
  }
  return /^(ads?_)?(get|list|read|search|show|fetch|describe|find|preview|inspect|insights|report|export|check|status|query|validate)/.test(name);
}

/** Stable fingerprint of a tool's input, so "what you saw" can be compared to "what runs". */export function approveFingerprint(input: unknown): string {
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

/**
 * Close the approval requests nobody can act on any more.
 *
 * While the approval card was invisible, every refusal wrote a fresh pending row
 * and nothing could ever approve one. That left 42 pending approvals on this
 * account, 40 of them image requests from two days earlier. They are not merely
 * clutter: each is a staged action with the exact arguments attached, so an old
 * card is an old decision waiting to be tapped by mistake.
 *
 * The decision itself cannot be undone — an expired row simply stops being
 * offered. Anything already `approved` or `used` is untouched.
 */
export async function expireStaleApprovals(
  supabaseAdmin: any,
  olderThanHours = 24
): Promise<number> {
  const hours = Number.isFinite(olderThanHours) && olderThanHours > 0 ? olderThanHours : 24;
  const cutoff = new Date(Date.now() - hours * 60 * 60_000).toISOString();
  try {
    const { data, error } = await supabaseAdmin
      .from('agent_events')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('event_type', 'PENDING_ACTION_APPROVAL')
      .eq('status', 'pending')
      .lt('created_at', cutoff)
      .select('id');
    if (error) {
      console.warn('[Review gate] could not expire stale approvals:', error.message);
      return 0;
    }
    const count = Array.isArray(data) ? data.length : 0;
    if (count) console.log(`[Review gate] expired ${count} stale approval(s) older than ${hours}h`);
    return count;
  } catch (err: any) {
    console.warn('[Review gate] expiring stale approvals threw:', err?.message || err);
    return 0;
  }
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
        // A conditional policy can let this particular call through — e.g. only the DELIVERY render of a
        // film is gated, not the drafts the agent renders to check its own work.
        if (policy.when && !policy.when(input)) {
          return definition.execute(input, ...rest);
        }

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
              'again with its `approvalId` AND the same arguments you asked about. The approved arguments ' +
              'are what run, so the ones you repeat cannot change the job — but the tool still requires ' +
              'its own fields, so a call carrying only the approvalId is rejected before it gets here.',
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
