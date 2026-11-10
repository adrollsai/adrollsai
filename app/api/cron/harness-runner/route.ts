import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { claimRun, finishRun, heartbeatRun, reapRuns, runsAvailableCheck } from '@/lib/agent/harness/runs';
import { executeRunSlice } from '@/lib/agent/harness/runner';
import { cronAuthGuard } from '@/lib/agent/harness/cron-auth';

/**
 * Durable-run worker. Invoked by Vercel cron (see vercel.json).
 *
 * Each invocation claims runs and advances each by one bounded slice, then
 * exits. A run that still has work is re-queued with a checkpoint, so a task
 * that needs hours is spread across many short invocations instead of being
 * killed by a request timeout.
 *
 * Concurrency safety comes from `harness_claim_run` (SKIP LOCKED) plus the
 * lease: overlapping cron invocations never take the same run, and a worker
 * that dies mid-slice has its run reclaimed once the lease expires.
 */
export const maxDuration = 1800;

/** Leave headroom under maxDuration so we always finish and release leases. */
const WORKER_BUDGET_MS = 1_740_000;
/** One slice stops well before the worker does, so its checkpoint is safe. */
const DEFAULT_SLICE_BUDGET_MS = 1_700_000;
const DEFAULT_SLICE_MAX_STEPS = 30;
const LEASE_SECONDS = 300;

function envInt(name: string, fallback: number): number {
  const raw = (process.env[name] || '').replace(/^["']|["']$/g, '').trim();
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Slice limits can be overridden per invocation by a caller holding
 * CRON_SECRET. That is how a tiny slice can be forced in a test to exercise the
 * checkpoint/continue path without waiting for a real long task. Values are
 * clamped so a bad override cannot exceed the worker's own budget.
 */
function sliceLimits(req: Request): { budgetMs: number; maxSteps: number } {
  const q = new URL(req.url).searchParams;
  const budget = Number(q.get('budgetMs'));
  const steps = Number(q.get('maxSteps'));
  return {
    budgetMs: Number.isFinite(budget) && budget > 0 ? Math.min(budget, WORKER_BUDGET_MS - 20_000) : DEFAULT_SLICE_BUDGET_MS,
    maxSteps: Number.isFinite(steps) && steps > 0 ? Math.min(Math.floor(steps), 200) : DEFAULT_SLICE_MAX_STEPS,
  };
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}

async function handle(req: Request) {
  const denied = cronAuthGuard(req);
  if (denied) return denied;

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  if (!(await runsAvailableCheck(admin))) {
    return NextResponse.json({ error: 'harness_runs is not initialized' }, { status: 503 });
  }

  const worker = `cron-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const deadline = Date.now() + WORKER_BUDGET_MS;
  const limits = sliceLimits(req);
  const maxPerUser = envInt('HARNESS_MAX_PER_USER', 2);
  const maxTotal = envInt('HARNESS_MAX_TOTAL', 8);
  const processed: Array<{ runId: string; status: string; steps: number; error?: string }> = [];

  // Housekeeping: dead-letter over-deadline runs and abandoned ones first.
  const reaped = await reapRuns(admin);
  if (reaped.reapedDeadline || reaped.reapedStuck) {
    console.log(
      `[harness-runner] reaped ${reaped.reapedDeadline} over-deadline, ${reaped.reapedStuck} abandoned`
    );
  }

  while (Date.now() < deadline) {
    const run = await claimRun(admin, worker, LEASE_SECONDS, maxPerUser, maxTotal);
    if (!run) break; // queue is empty or at the concurrency ceiling

    const result = await executeRunSlice(admin, run, {
      worker,
      budgetMs: limits.budgetMs,
      maxSteps: limits.maxSteps,
      onHeartbeat: () => heartbeatRun(admin, run.id, worker, LEASE_SECONDS),
    });

    const finished = await finishRun(admin, run.id, worker, {
      status: result.status,
      checkpoint: result.checkpoint ?? null,
      error: result.error ?? null,
      nextAttemptAt: result.nextAttemptAt ?? null,
      incrementAttempt: result.incrementAttempt ?? false,
    });

    processed.push({
      runId: run.id,
      status: result.status,
      steps: result.steps,
      ...(result.error ? { error: result.error } : {}),
    });

    if (!finished) {
      console.warn(`[harness-runner] lost the lease on run ${run.id} — stopping this tick.`);
      break;
    }

    // Not enough time left for another slice; the next cron tick continues.
    if (Date.now() > deadline - 30_000) break;
  }

  if (processed.length) {
    console.log(`[harness-runner] ${worker} processed ${processed.length} slice(s)`);
  }

  return NextResponse.json({ worker, processed, idle: processed.length === 0 });
}
