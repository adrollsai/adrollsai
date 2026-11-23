/**
 * The vocabulary of the ops watchdog.
 *
 * One idea holds this whole system together: **a detector reports, it never acts.**
 * Detectors only describe what is wrong and what they would do about it. The decision to
 * act lives in `repairs.ts` behind an allowlist, and the loop that calls both lives in
 * `healer.ts`. Keeping those three apart is what makes "it fixed something on its own"
 * auditable instead of mysterious: you can read every detector without reading any repair,
 * and you can audit every repair without trusting a model.
 *
 * WHY `blastRadius` SITS ON THE DETECTION AND NOT ON THE REPAIR
 * The dangerous direction of trust is a detector that quietly widens what may be fixed.
 * So a detection declares its own blast radius, and the healer refuses to act on anything
 * that claims `safe` unless a repair is registered for that exact class AND the repair
 * agrees about the radius. Two independent "yes" answers, from two different files, before
 * a write reaches production.
 */

/** How bad it is, in the order a person would want to hear it. */
export type Severity = 'critical' | 'warning' | 'info';

/**
 * How much damage a wrong decision causes.
 *
 * `safe` — a reversible fix to a state machine: an expired lease, a lost lock, a queued row
 * nobody will ever pick up. Applying it when we are wrong costs a retry.
 *
 * `needs_approval` — money, a customer, a campaign, or code. Applying it when we are wrong
 * costs something we cannot take back, so a human decides.
 */
export type BlastRadius = 'safe' | 'needs_approval';

export type IncidentStatus = 'open' | 'repaired' | 'resolved' | 'needs_approval' | 'ignored';

/** One condition, as a detector found it. Pure data — no side effects, no Supabase handles. */
export interface Detection {
  /** Detector class, e.g. `harness-run-dead-lettered`. Also the repair lookup key. */
  class: string;
  severity: Severity;
  /** The headline, in the owner's language. Not "harness_runs.status=dead". */
  title: string;
  /** The numbers it came from. Never empty — an incident without evidence is an opinion. */
  evidence: string;
  /** What we would do about it, as a suggestion the owner can disagree with. */
  suggestedFix: string;
  blastRadius: BlastRadius;
  /** The row this is about, so a repair knows exactly what to touch. */
  subjectTable?: string;
  subjectId?: string;
  /** Tenant affected, when the problem belongs to one. */
  userId?: string | null;
  /**
   * Distinguishes several conditions of the same class. Defaults to `subjectId`.
   *
   * Needed wherever one class can fire more than once at a time — five dead runs are one
   * systemic bug but they are five separate rows, and a stuck video task is a row per task.
   */
  fingerprintKey?: string;
  /** Anything else worth keeping for the diagnosis: ids, counts, error heads. */
  detail?: Record<string, unknown>;
}

/** The incident as stored. Mirrors `public.ops_incidents`. */
export interface Incident {
  id: string;
  fingerprint: string;
  class: string;
  severity: Severity;
  title: string;
  evidence: string;
  suggested_fix: string | null;
  blast_radius: BlastRadius;
  status: IncidentStatus;
  subject_table: string | null;
  subject_id: string | null;
  user_id: string | null;
  occurrences: number;
  repair_attempts: number;
  repair_log: RepairLogEntry[];
  first_seen_at: string;
  last_seen_at: string;
  last_repaired_at: string | null;
  resolved_at: string | null;
  notified_at: string | null;
  detail: Record<string, unknown> | null;
}

/** One attempt to fix something. Appended to `ops_incidents.repair_log`. */
export interface RepairLogEntry {
  at: string;
  /** `applied` changed production state; `refused` did not and says why. */
  outcome: 'applied' | 'refused' | 'failed';
  detail: string;
  /** The exact columns the repair wrote, for the audit trail. */
  touched?: string[];
}

/** Everything a detector is given. Injected, so a detector can be tested with fakes. */
export interface DetectorContext {
  /**
   * A service-role Supabase client.
   *
   * Typed loosely on purpose: `supabase/database.types.ts` in this repo is stale and this
   * new table is not in it. Same choice `utils/credits.ts` and the video watchdog make.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  /** Injected clock. Every detector's window is relative to this, so tests are stable. */
  now: Date;
  /** Extra context a detector may use, e.g. the production URL to probe. */
  config: OpsConfig;
}

export interface OpsConfig {
  /** Base URL of the running app, for the reachability probe. */
  appUrl: string | null;
  /** How far back a detector looks for *recurring* failure. */
  lookbackMinutes: number;
}

/**
 * A detector. `watches` is prose because the console lists detectors to a human — a
 * registry of strings like "harness_runs" tells nobody what is or is not being watched.
 */
export interface Detector {
  id: string;
  /** One line, in English: what this watches and why it matters. */
  watches: string;
  run(ctx: DetectorContext): Promise<Detection[]>;
}

/** What a repair did. `ok: false` is a refusal or a failure, and `detail` says which. */
export interface RepairOutcome {
  ok: boolean;
  detail: string;
  touched?: string[];
}

/**
 * A registered fix.
 *
 * `table` and `columns` are declarations, and the healer enforces them: a repair may only
 * run on an incident whose `subjectTable` matches `table`, and only the columns listed here
 * are considered touched. That stops the classic drift where a "safe" repair gradually
 * grows a second update statement nobody reviewed.
 */
export interface Repair {
  /** The detector class this repair handles. Exactly one repair per class. */
  class: string;
  /** Must agree with the detection's radius, or the healer refuses. */
  blastRadius: BlastRadius;
  /** One line for the audit trail: what this does to production. */
  describe: string;
  table: string;
  columns: string[];
  /** Apply it. Must be idempotent: a repair that already happened reports ok. */
  apply(incident: Incident, ctx: DetectorContext): Promise<RepairOutcome>;
}

/** The result of one sweep, for the response body and the verify gate. */
export interface SweepResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** Detector id → how many conditions it reported. A zero is information, not a fault. */
  detected: Record<string, number>;
  /** Detectors that threw. The sweep continues: one broken detector must not blind the rest. */
  detectorErrors: { detector: string; error: string }[];
  created: number;
  recurring: number;
  // Parentheses are load-bearing: `A & B[]` parses as `A & (B[])`, not `(A & B)[]`,
  // which is an object intersected with an ARRAY — so `.outcome`, `.detail` and
  // `.touched` were unreachable and `repaired.push(...)` could not type-check.
  repaired: (RepairLogEntry & { fingerprint: string; class: string })[];
  awaitingApproval: number;
  autoResolved: number;
  notified: number;
  /** True when the healer's own guardrails suppressed an action. */
  suppressed: { fingerprint: string; reason: string }[];
}
