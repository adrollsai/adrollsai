/* eslint-disable @typescript-eslint/no-explicit-any --
 * Same choice lib/automation/billing.ts and utils/credits.ts make: the generated
 * supabase/database.types.ts is stale, so typing these PostgREST chains against
 * it would produce false errors and hide real ones.
 */
/**
 * Supabase store adapter for the durable sandbox runner.
 *
 * The runner's one requirement is `load(runId) -> Checkpoint | null` and
 * `save(runId, checkpoint)`. This maps that onto one row of `public.agent_runs`
 * (see supabase/migrations/20261215000000_agent_runs.sql).
 *
 * Design notes:
 *
 *  - `load` throws a readable `StoreError` instead of returning null when the row
 *    cannot be read. Returning null would mean "this run never started", and the
 *    runner would then redo (and re-charge for) work that is already done. A run
 *    that fails to start is strictly better than one that pays twice.
 *  - `save` is an upsert keyed on `run_id`, so a paused run, a resumed run and a
 *    retried run all write the same row. `held`/`charged` are a checkpoint, not
 *    the ledger — the authoritative money lives in credit_holds and
 *    credit_transactions.
 *  - `status` is 'running' from `save` (the runner owns the row while it works).
 *    Terminal states are recorded by the caller through `setStatus`, which is an
 *    optional extension: the plain `load`/`save` interface the runner declares is
 *    still all it needs.
 */

import type { Checkpoint } from './runner';
import type { AgentLogger } from './log';
import { silentLogger } from './log';

export type AgentRunStatus = 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

/** The durable record: the checkpoint plus the fields the dashboard needs. */
export interface AgentRunRecord extends Checkpoint {
  userId: string | null;
  status: AgentRunStatus | null;
  lastError: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Exactly what runner.ts asks for. */
export interface RunnerStore {
  load(runId: string): Promise<Checkpoint | null>;
  save(runId: string, checkpoint: Checkpoint): Promise<void>;
}

/** What this adapter additionally offers. */
export interface AgentRunStore extends RunnerStore {
  read(runId: string): Promise<AgentRunRecord | null>;
  setStatus(runId: string, status: AgentRunStatus, lastError?: string | null): Promise<void>;
}

export class StoreError extends Error {
  readonly op: 'load' | 'save' | 'read' | 'status';

  constructor(op: StoreError['op'], message: string) {
    super(message);
    this.name = 'StoreError';
    this.op = op;
    Object.setPrototypeOf(this, StoreError.prototype);
  }
}

export interface SupabaseStoreOptions {
  /** A service-role Supabase client. Never a user-scoped one: writes are RLS-closed. */
  supabase: any;
  /** Who owns the run. Stored for RLS (`auth.uid() = user_id`) and reporting. */
  userId?: string | null;
  table?: string;
  log?: AgentLogger;
}

const TABLE = 'agent_runs';

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * jsonb comes back as an array, but a text column, a JSON-string payload or a
 * hand-edited row must not silently become "no steps completed".
 */
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v));
    } catch {
      return [];
    }
  }
  return [];
}

function toCheckpoint(row: any): Checkpoint {
  return {
    runId: String(row.run_id),
    sandboxId: row.sandbox_id == null ? '' : String(row.sandbox_id),
    completed: toStringArray(row.completed),
    continuousMs: num(row.continuous_ms),
    held: num(row.held),
    charged: num(row.charged),
  };
}

function errorText(error: any): string {
  if (!error) return 'unknown error';
  return String(error.message || error.code || error);
}

export function createSupabaseStore(options: SupabaseStoreOptions): AgentRunStore {
  const log = options.log ?? silentLogger;
  const supabase = options.supabase;
  const table = options.table ?? TABLE;

  if (!supabase || typeof supabase.from !== 'function') {
    throw new StoreError('load', 'agent_runs store needs a Supabase client (options.supabase)');
  }

  const selectRow = async (runId: string): Promise<any | null> => {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('run_id', runId)
      .maybeSingle();
    if (error) {
      throw new StoreError(
        'load',
        `agent_runs: could not read run ${runId}: ${errorText(error)}. Refusing to resume blind - ` +
          'a lost checkpoint would re-run (and re-charge) completed steps.',
      );
    }
    return data ?? null;
  };

  return {
    async load(runId: string): Promise<Checkpoint | null> {
      const row = await selectRow(runId);
      if (!row) return null;
      const checkpoint = toCheckpoint(row);
      log('store.loaded', {
        runId,
        completed: checkpoint.completed.length,
        continuousMs: checkpoint.continuousMs,
        sandboxId: checkpoint.sandboxId || null,
      });
      return checkpoint;
    },

    async read(runId: string): Promise<AgentRunRecord | null> {
      const row = await selectRow(runId);
      if (!row) return null;
      return {
        ...toCheckpoint(row),
        userId: row.user_id == null ? null : String(row.user_id),
        status: (row.status ?? null) as AgentRunStatus | null,
        lastError: row.last_error == null ? null : String(row.last_error),
        createdAt: row.created_at == null ? null : String(row.created_at),
        updatedAt: row.updated_at == null ? null : String(row.updated_at),
      };
    },

    async save(runId: string, checkpoint: Checkpoint): Promise<void> {
      const row = {
        run_id: runId,
        user_id: options.userId ?? null,
        sandbox_id: checkpoint.sandboxId || null,
        completed: checkpoint.completed,
        continuous_ms: Math.max(0, Math.round(num(checkpoint.continuousMs))),
        held: num(checkpoint.held),
        charged: num(checkpoint.charged),
        status: 'running' as AgentRunStatus,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from(table).upsert(row, { onConflict: 'run_id' });
      if (error) {
        // A checkpoint we cannot write is a checkpoint we cannot resume from, and
        // the runner is about to charge for the step it just finished.
        throw new StoreError(
          'save',
          `agent_runs: could not checkpoint run ${runId} after step ${checkpoint.completed.slice(-1)[0] ?? '(none)'}: ${errorText(error)}`,
        );
      }

      log('store.saved', {
        runId,
        completed: checkpoint.completed.length,
        continuousMs: row.continuous_ms,
        held: row.held,
        charged: row.charged,
      });
    },

    async setStatus(
      runId: string,
      status: AgentRunStatus,
      lastError?: string | null,
    ): Promise<void> {
      const { error } = await supabase
        .from(table)
        .update({
          status,
          last_error: lastError == null ? null : String(lastError).slice(0, 2000),
          updated_at: new Date().toISOString(),
        })
        .eq('run_id', runId);
      if (error) {
        throw new StoreError(
          'status',
          `agent_runs: could not record status "${status}" for run ${runId}: ${errorText(error)}`,
        );
      }
      log('store.status', { runId, status, lastError: lastError ?? null });
    },
  };
}
