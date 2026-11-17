/** Triggers are validated against the runner's vocabulary by the flow builder; this module only
 *  needs their identity, so it stays free of that dependency. */
export type FlowTrigger = string;

/**
 * Trigger conflicts, decided by structure — never by prose.
 *
 * The previous check looked for the trigger's name inside a flow's description string, which
 * produced both failures at once: two flows whose descriptions happened to mention the same word
 * were treated as duplicates (false positive), and two flows that genuinely shared a trigger but
 * worded it differently were both accepted (false negative).
 *
 * A trigger is now identified by a key derived from its fields. Two flows conflict only when their
 * keys are equal, so the answer is exact and the same every time.
 */

export interface FlowIdentity {
  id?: string | null;
  name: string;
  title?: string | null;
  triggerType: FlowTrigger;
  /** For button/template triggers: which template starts it. Different templates may coexist. */
  triggerKey?: string | null;
  isActive?: boolean | null;
}

/** The canonical identity of a trigger. Two flows may fire on the same event only if this differs. */
export function triggerKey(triggerType: FlowTrigger, templateName?: string | null): string {
  const template = (templateName ?? '').trim().toLowerCase();
  return template ? `${triggerType}:${template}` : triggerType;
}

export function identityKey(flow: FlowIdentity): string {
  return triggerKey(flow.triggerType, flow.triggerKey);
}

export interface ConflictResult {
  conflict: FlowIdentity | null;
  /** Everything on the same trigger key, whether or not one of them blocks. */
  sharingTrigger: FlowIdentity[];
}

/**
 * Structural conflict: at most one flow per trigger key. Deliberately exact — no similarity
 * scoring, no keyword matching, so the same input always yields the same verdict.
 */
export function findTriggerConflict(existing: FlowIdentity[], candidate: FlowIdentity): ConflictResult {
  const key = identityKey(candidate);
  const sharingTrigger = existing.filter((f) => identityKey(f) === key && f.id !== candidate.id);
  return { conflict: sharingTrigger[0] ?? null, sharingTrigger };
}

/** Human-readable refusal that names the fix, not just the problem. */
export function describeConflict(candidate: FlowIdentity, conflict: FlowIdentity): string {
  const key = identityKey(candidate);
  const state = conflict.isActive ? 'active' : 'paused';
  return (
    `"${conflict.title ?? conflict.name}" already listens on ${key} (id ${conflict.id ?? 'unknown'}, ${state}). ` +
    `Two flows on the same trigger would message every matching person twice. ` +
    `Edit that flow, or put this one on a different trigger — for a template button, a different template is a different trigger.`
  );
}
