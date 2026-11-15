/**
 * Reconciliation: did the wallet move by exactly what the work cost?
 *
 * THE MODEL (already in place, this file only reads it)
 *
 *   credit_holds         a reservation against one job: `amount`, `spent`, and a
 *                        state of `open` / `settled` / `released`. A hold never
 *                        moves money.
 *   credit_transactions  the ledger. A charge is a NEGATIVE amount; a grant is a
 *                        positive one. A charge carries `ref = agent_run:<run>:<step>`,
 *                        uniquely indexed, which is what makes it exactly-once.
 *
 * So for one run there are two independent records of the same event: the hold's
 * own `spent` counter, and the sum of the ledger rows that name the run. If those
 * two disagree, something is wrong and no amount of retrying fixes it — a charge
 * was applied without updating the hold, or a hold was settled while a ledger row
 * was rolled back. That is exactly the class of bug that makes a customer's balance
 * drift away from their receipts, and it is invisible unless something compares the
 * two. This module does that comparison.
 *
 * THE PROPERTY WORTH GUARDING
 *
 *   A run that FAILED nets zero. It may have reserved 300 credits, but if no step
 *   completed, no ledger row exists for it and the remainder is released — so the
 *   wallet is exactly where it started. `netCredits === 0` and `verdict ===
 *   'no-movement'` is the assertion, and it is the one a support conversation
 *   about "where did my credits go" needs.
 *
 * PURE, over injected rows. The readers below are the only I/O, they are separate
 * functions, and the maths never touches Supabase — so the whole reconciliation can
 * be driven from a test with a hand-written ledger.
 */

/** The subset of a `credit_transactions` row reconciliation needs. */
export interface LedgerRow {
  amount: number;
  category?: string | null;
  description?: string | null;
  ref?: string | null;
  created_at?: string | null;
}

/** The subset of a `credit_holds` row reconciliation needs. */
export interface HoldRow {
  id?: string | null;
  job_id: string;
  amount: number;
  spent: number;
  state: 'open' | 'settled' | 'released' | string;
  reason?: string | null;
  created_at?: string | null;
  settled_at?: string | null;
}

/** The ledger prefix `lib/agent/sandbox/credits.ts` writes for every step charge. */
export const RUN_REF_PREFIX = 'agent_run:';

/** `agent_run:run-123:s3` -> `run-123`; anything else -> null. */
export function runIdFromRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const text = String(ref);
  if (!text.startsWith(RUN_REF_PREFIX)) return null;
  const rest = text.slice(RUN_REF_PREFIX.length);
  const separator = rest.lastIndexOf(':');
  const runId = separator === -1 ? rest : rest.slice(0, separator);
  return runId || null;
}

/** `agent_run:run-123:s3` -> `s3`; null when the ref does not name a step. */
export function stepFromRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const text = String(ref);
  if (!text.startsWith(RUN_REF_PREFIX)) return null;
  const rest = text.slice(RUN_REF_PREFIX.length);
  const separator = rest.lastIndexOf(':');
  return separator === -1 ? null : rest.slice(separator + 1) || null;
}

export type RunVerdict =
  /** Nothing moved: every reservation came back. The failed-run case. */
  | 'no-movement'
  /** The wallet paid for at least one step, and the hold agrees. */
  | 'charged'
  /** Nothing was ever reserved: charges went straight to the ledger. */
  | 'charged-without-hold'
  /** The hold's own counter and the ledger disagree. Somebody must look. */
  | 'mismatch'
  /** Still reserved and unfinished, so the money is not available yet. */
  | 'open';

export interface RunReconciliation {
  runId: string;
  /** Net wallet movement in credits: negative means the customer paid. */
  netCredits: number;
  /** Credits the ledger says were charged for this run, as a positive number. */
  chargedCredits: number;
  /** One entry per distinct step charged, in ledger order. */
  steps: { step: string; credits: number; ref: string }[];
  /** The reservation, when one was found. */
  hold: {
    id: string | null;
    amount: number;
    spent: number;
    released: number;
    state: string;
  } | null;
  /** Credits the hold still has reserved and unavailable. */
  stillReservedCredits: number;
  /** True when the hold's `spent` equals the ledger's charges for this run. */
  agrees: boolean;
  verdict: RunVerdict;
  /** One line for a log, a support reply, or an admin row. */
  verdictText: string;
  /** Everything that looked wrong, in words. Empty is the healthy case. */
  problems: string[];
}

const round = (value: number, dp = 2): number => {
  const factor = 10 ** dp;
  // The ledger column is numeric, so half-credit amounts are real (a 0.2-credit
  // WhatsApp message). Two decimal places is the currency, not a fudge.
  return Math.round((Number(value) || 0) * factor) / factor;
};

/**
 * Reconcile ONE run against its own ledger rows and hold.
 *
 * `rows` and `hold` are exactly what the database says; nothing here is optional
 * guesswork. Rows for other runs are ignored rather than counted, so a caller can
 * pass a user's whole recent ledger without filtering it first.
 */
export function reconcileRun(
  runId: string,
  rows: readonly LedgerRow[],
  hold: HoldRow | null,
): RunReconciliation {
  const id = String(runId);
  const problems: string[] = [];

  const mine = rows.filter((row) => runIdFromRef(row.ref) === id);

  // A charge is negative in the ledger. Group by step so two rows for one step
  // (which should be impossible: the ref is unique) are visible rather than summed.
  const byStep = new Map<string, { credits: number; ref: string; count: number }>();
  let netCredits = 0;
  for (const row of mine) {
    const amount = Number(row.amount) || 0;
    netCredits += amount;
    if (amount >= 0) continue;
    const step = stepFromRef(row.ref) ?? '(no step)';
    const existing = byStep.get(step);
    byStep.set(step, {
      credits: round((existing?.credits ?? 0) + Math.abs(amount)),
      ref: String(row.ref),
      count: (existing?.count ?? 0) + 1,
    });
  }

  const steps = [...byStep.entries()].map(([step, entry]) => ({
    step,
    credits: entry.credits,
    ref: entry.ref,
  }));
  for (const [step, entry] of byStep) {
    if (entry.count > 1) {
      problems.push(
        `step "${step}" appears in ${entry.count} ledger rows totalling ${entry.credits} credits; ` +
          `the ref "${entry.ref}" should be unique, so the ledger has a duplicate`,
      );
    }
  }

  const chargedCredits = round(steps.reduce((sum, step) => sum + step.credits, 0));

  const holdView = hold
    ? {
        id: hold.id ?? null,
        amount: round(hold.amount),
        spent: round(hold.spent),
        released: round(Math.max(0, Number(hold.amount) - Number(hold.spent))),
        state: String(hold.state),
      }
    : null;

  const stillReservedCredits = holdView && holdView.state === 'open' ? round(holdView.amount - holdView.spent) : 0;

  // The cross-check. A hold with no charges and a ledger with charges is the
  // "charged without a reserve" path, which is legitimate when the RPCs are
  // missing — it is reported, not condemned.
  const agrees = holdView ? round(holdView.spent) === chargedCredits : true;

  let verdict: RunVerdict;
  if (!agrees) {
    verdict = 'mismatch';
    problems.push(
      `the hold says ${holdView?.spent} credits were spent but the ledger has ${chargedCredits} charged ` +
        `(${round(chargedCredits - (holdView?.spent ?? 0))} credits apart). One of the two is wrong; ` +
        'do not trust either figure until it is resolved.',
    );
  } else if (holdView && holdView.state === 'open' && chargedCredits === 0) {
    verdict = 'open';
  } else if (chargedCredits === 0) {
    verdict = 'no-movement';
  } else if (!holdView) {
    verdict = 'charged-without-hold';
  } else {
    verdict = 'charged';
  }

  // An over-charged hold and a net-positive run are both impossible by
  // construction, so if either appears the schema or the charge path changed.
  if (holdView && chargedCredits > holdView.amount) {
    problems.push(
      `this run charged ${chargedCredits} credits against a ${holdView.amount}-credit reservation; ` +
        'a hold must never be exceeded',
    );
  }
  if (netCredits > 0) {
    problems.push(
      `the run's ledger is net POSITIVE (${netCredits}): a run may only ever be refunded against its own ` +
        'reservation, so a positive movement means a grant was keyed to a run ref',
    );
  }

  const verdictText = (() => {
    switch (verdict) {
      case 'no-movement':
        return `run ${id}: net 0 credits — nothing was spent${
          holdView ? `, the ${holdView.released}-credit reservation was released` : ''
        }`;
      case 'charged':
        return `run ${id}: net ${netCredits} credits over ${steps.length} step(s)${
          holdView?.state !== 'open' && holdView ? `, ${holdView.released} released` : ''
        }`;
      case 'charged-without-hold':
        return `run ${id}: net ${netCredits} credits over ${steps.length} step(s), charged straight to the ledger (no reservation)`;
      case 'mismatch':
        return `run ${id}: MISMATCH — hold spent ${holdView?.spent}, ledger charged ${chargedCredits}`;
      case 'open':
        return `run ${id}: still open, ${stillReservedCredits} credits reserved and unavailable`;
      default:
        return `run ${id}: ${verdict}`;
    }
  })();

  return {
    runId: id,
    netCredits: round(netCredits),
    chargedCredits,
    steps,
    hold: holdView,
    stillReservedCredits,
    agrees,
    verdict,
    verdictText,
    problems,
  };
}

/**
 * Reconcile a whole user's recent ledger, grouped by run.
 *
 * Rows that name no run (a subscription grant, a top-up, a WhatsApp message billed
 * per message) are summed separately in `otherNetCredits`, so the total still adds
 * up: `netCredits === runs + other`. An accounting view that quietly drops the rows
 * it did not understand is worse than no view.
 */
export interface LedgerSummary {
  /** Net movement of every row considered, in credits. Negative = the customer paid. */
  netCredits: number;
  /** Same, restricted to rows that name a run. */
  runNetCredits: number;
  /** Credits granted (positive rows), as a positive number. */
  grantedCredits: number;
  /** Credits spent (negative rows), as a positive number. */
  spentCredits: number;
  /** One reconciliation per run, newest hold first. */
  runs: RunReconciliation[];
  /** Net movement of the rows that name no run. */
  otherNetCredits: number;
  /** How many rows had no `ref` at all. */
  rowsWithoutRef: number;
  problems: string[];
}

export function summariseLedger(
  rows: readonly LedgerRow[],
  holds: readonly HoldRow[] = [],
): LedgerSummary {
  const problems: string[] = [];
  const byRun = new Map<string, LedgerRow[]>();
  let grantedCredits = 0;
  let spentCredits = 0;
  let netCredits = 0;
  let otherNetCredits = 0;
  let rowsWithoutRef = 0;
  const holdsByJob = new Map<string, HoldRow>();

  for (const hold of holds) {
    const jobId = String(hold.job_id ?? '');
    if (!jobId) continue;
    // One open hold per job is a database constraint, so last-write-wins would hide
    // a violation. Keep the first and complain about the second.
    if (holdsByJob.has(jobId)) {
      problems.push(
        `job ${jobId} has more than one hold in this set; ` +
          'credit_holds_open_job_uniq allows one open hold per job, so the set is inconsistent',
      );
      continue;
    }
    holdsByJob.set(jobId, hold);
  }

  for (const row of rows) {
    const amount = Number(row.amount) || 0;
    netCredits += amount;
    if (amount > 0) grantedCredits += amount;
    else spentCredits += Math.abs(amount);

    if (!row.ref) {
      rowsWithoutRef++;
      otherNetCredits += amount;
      continue;
    }
    const runId = runIdFromRef(row.ref);
    if (!runId) {
      otherNetCredits += amount;
      continue;
    }
    const bucket = byRun.get(runId) ?? [];
    bucket.push(row);
    byRun.set(runId, bucket);
  }

  const runs = [...byRun.entries()].map(([runId, runRows]) =>
    reconcileRun(runId, runRows, holdsByJob.get(runId) ?? null),
  );

  const runNetCredits = round(runs.reduce((sum, run) => sum + run.netCredits, 0));
  // Holds that exist for a run with no charges still matter: they are money the
  // customer cannot spend right now.
  const orphanHolds = [...holdsByJob.entries()].filter(([jobId]) => !byRun.has(jobId));
  for (const [jobId, hold] of orphanHolds) {
    if (String(hold.state) === 'open') {
      runs.push(reconcileRun(jobId, [], hold));
    }
  }
  runs.sort((a, b) => (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0));

  for (const run of runs) {
    for (const problem of run.problems) problems.push(problem);
  }

  if (round(netCredits) !== round(runNetCredits + otherNetCredits)) {
    problems.push(
      `the total does not add up: everything nets ${round(netCredits)} but runs net ${runNetCredits} plus ` +
        `${round(otherNetCredits)} outside runs — the classifier lost a row`,
    );
  }

  return {
    netCredits: round(netCredits),
    runNetCredits,
    grantedCredits: round(grantedCredits),
    spentCredits: round(spentCredits),
    runs,
    otherNetCredits: round(otherNetCredits),
    rowsWithoutRef,
    problems,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// The readers (the only I/O)
// ────────────────────────────────────────────────────────────────────────────

/** What the readers need from a Supabase client. Kept loose on purpose: the
 *  generated database types are stale, as `lib/automation/billing.ts` explains. */
export interface LedgerReader {
  transactions(input: { userId: string; limit: number }): Promise<LedgerRow[]>;
  holds(input: { userId: string; limit: number }): Promise<HoldRow[]>;
}

/**
 * Read one user's ledger and holds, newest first.
 *
 * READ ONLY. There is no writer in this module and none should be added: an admin
 * view that can also fix a balance is an admin view that can lose the audit trail.
 */
export function supabaseLedgerReader(supabaseAdmin: any): LedgerReader {
  return {
    async transactions({ userId, limit }) {
      const { data, error } = await supabaseAdmin
        .from('credit_transactions')
        .select('amount, category, description, ref, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw new Error(`could not read credit_transactions: ${String(error.message || error)}`);
      return (data ?? []) as LedgerRow[];
    },
    async holds({ userId, limit }) {
      const { data, error } = await supabaseAdmin
        .from('credit_holds')
        .select('id, job_id, amount, spent, state, reason, created_at, settled_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw new Error(`could not read credit_holds: ${String(error.message || error)}`);
      return (data ?? []) as HoldRow[];
    },
  };
}

/** The default window an admin view reads. Big enough to cover a billing cycle. */
export const DEFAULT_LEDGER_LIMIT = 500;

/**
 * The whole read-only view for one user: net movement, per-run verdicts, problems.
 *
 * This is what `GET /api/admin/ledger?user_id=…` returns, and what a support
 * person reads before answering "where did my credits go".
 */
export async function readLedger(
  reader: LedgerReader,
  options: { userId: string; limit?: number },
): Promise<LedgerSummary & { userId: string; limit: number }> {
  const userId = String(options.userId ?? '').trim();
  if (!userId) throw new Error('readLedger needs a userId');
  const limit = Math.max(1, Math.min(5000, Math.floor(Number(options.limit) || DEFAULT_LEDGER_LIMIT)));

  const [rows, holds] = await Promise.all([
    reader.transactions({ userId, limit }),
    reader.holds({ userId, limit }),
  ]);

  return { ...summariseLedger(rows, holds), userId, limit };
}
