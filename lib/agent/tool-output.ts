/**
 * Reading a tool result the way the UI needs to read it.
 *
 * THE BUG THIS EXISTS FOR
 * The model reaches most of its tools through a discovery proxy: `call_tool(name,
 * args)` runs the real tool and returns `{ ok, tool, result }`, so the real
 * result sits one level DOWN. Every renderer looked for `output.artifact` at the
 * top level, which meant that for any proxied tool:
 *
 *   - an approval card was never drawn (WhatsApp send, AI voice call — neither is
 *     in the inline hot set, so they are ALWAYS proxied, so their approval card
 *     could never appear at all);
 *   - a question asked through the proxy was never drawn, and the same latent bug
 *     sat in the question panel;
 *   - image, audio and video artefacts produced by proxied tools were drawn as a
 *     bare grey "call tool" row.
 *
 * The owner then had no way to approve: the gate only unlocks an action whose
 * approval row says `approved`, and nothing on screen could mark it. The agent
 * kept staging fresh cards and telling the owner one was on screen.
 *
 * WHY IT IS A SHARED MODULE AND NOT A ONE-LINE FIX IN THE COMPONENT
 * Three separate places need the same answer (the feed row, the question panel,
 * the label), and the shapes must agree with what `lib/agent/harness/tool-proxy.ts`
 * produces. Keeping the unwrapping in one place — and pinning it with
 * `npm run verify:tool-artifacts` against the REAL proxy and the REAL gate — is
 * what stops this drifting apart again.
 */

/** The proxy's envelope: `{ ok, tool, result }`. */
export interface ToolEnvelope {
  ok?: boolean;
  tool?: string;
  result?: unknown;
}

const MAX_UNWRAP_DEPTH = 3;

/** True when this object is the discovery proxy's wrapper rather than a real result. */
export function isProxyEnvelope(value: unknown): value is ToolEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  // `ok` is a boolean and `result` is present. `tool` is a string when the call
  // succeeded; a failed proxy call returns `{ error, hint, sample }` with no
  // envelope at all, so it is left alone.
  return typeof v.ok === 'boolean' && 'result' in v;
}

/**
 * The real tool's output, with any proxy layering removed.
 *
 * Depth-limited on purpose: a malformed or self-referential payload must not be
 * able to spin this, and one level is all the proxy produces today.
 */
export function realToolOutput<T = any>(output: unknown): T {
  let current: unknown = output;
  for (let depth = 0; depth < MAX_UNWRAP_DEPTH; depth++) {
    if (!isProxyEnvelope(current)) break;
    current = (current as ToolEnvelope).result;
  }
  return current as T;
}

/**
 * The tool name a row should be labelled with.
 *
 * A proxied call is not "call tool" to the reader — it is "WhatsApp send". The
 * proxied target is in the envelope, so prefer it; fall back to the name we were
 * given.
 */
export function realToolName(toolName: string, output: unknown): string {
  if (toolName !== 'call_tool') return toolName;
  // Look at the innermost envelope for the target's name.
  let current: unknown = output;
  let named = '';
  for (let depth = 0; depth < MAX_UNWRAP_DEPTH; depth++) {
    if (!isProxyEnvelope(current)) break;
    const env = current as ToolEnvelope;
    if (typeof env.tool === 'string' && env.tool) named = env.tool;
    current = env.result;
  }
  return named || toolName;
}

/** The artefact to render for this result, from either shape. Null when there is none. */
export function artifactFrom(output: unknown): Record<string, any> | null {
  const inner: any = realToolOutput(output);
  if (!inner || typeof inner !== 'object') return null;

  // The normal case: the tool returned its artefact directly.
  if (inner.artifact && typeof inner.artifact === 'object' && inner.artifact.type) {
    return inner.artifact as Record<string, any>;
  }

  // Older shape: a staged approval described by actionPayload + requiresApproval.
  if (inner.requiresApproval === true || inner.needs_review === true) {
    const payload = inner.actionPayload ?? {};
    return {
      type: 'action_confirmation',
      actionType: payload.actionType ?? inner.actionType ?? 'custom',
      title: payload.title ?? 'Approval needed',
      description: payload.description ?? '',
      payload: payload.payload ?? undefined,
      actionId: inner.actionId ?? payload.actionId,
      status: 'pending',
    } as Record<string, any>;
  }

  // An artefact can also sit on the envelope itself, if a proxy layer ever adds
  // one. Cheap to support, and it means a future shape change degrades to
  // "card still appears" rather than "card silently vanishes".
  const outer: any = output;
  if (outer && typeof outer === 'object' && outer.artifact?.type) {
    return outer.artifact as Record<string, any>;
  }
  return null;
}

/**
 * Did this call fail? Checked through the proxy as well, because a proxied
 * failure reports `ok: false` on the envelope and the real reason inside it.
 *
 * A STAGED APPROVAL IS NOT A FAILURE. The gate refuses a gated tool with
 * `success: false` so the model cannot mistake it for done, but that is a step
 * waiting on the owner, not a broken tool — showing a red "failed" beside the
 * approval card makes a working agent look broken.
 */
export function isFailedToolOutput(output: unknown): boolean {
  const outer: any = output;
  if (outer && typeof outer === 'object' && outer.ok === false) return true;
  const inner: any = realToolOutput(output);
  if (!inner || typeof inner !== 'object') return false;
  if (inner.needs_review === true || inner.requiresApproval === true) return false;
  if (inner.success === false) return true;
  if (inner.ok === false) return true;
  return false;
}

/**
 * A staged approval that has not been decided yet.
 *
 * Used to keep one pending card per action type on screen instead of one per
 * retry — the gate writes a fresh row each time it refuses, so a conversation
 * that keeps retrying accumulates pending cards the owner never asked for.
 */
export function pendingApprovalFrom(output: unknown): { actionId: string; actionType: string } | null {
  const artifact = artifactFrom(output);
  if (!artifact || artifact.type !== 'action_confirmation') return null;
  const actionId = typeof artifact.actionId === 'string' ? artifact.actionId : '';
  if (!actionId) return null;
  const status = String(artifact.status ?? 'pending');
  if (status !== 'pending') return null;
  return { actionId, actionType: String(artifact.actionType ?? 'custom') };
}
