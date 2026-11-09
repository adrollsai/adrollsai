/**
 * Standalone durable-run worker.
 *
 * The cron route is one way to advance the queue (serverless, every minute).
 * This is the other: an always-on process that polls the queue continuously, for
 * hosts where a long-lived process is allowed (a container, a VM, E2B, or your
 * laptop). Same claim/lease/checkpoint semantics — the queue does not care who
 * drains it, and N of these can run side by side.
 *
 *   npm run worker
 *
 * Env:
 *   WORKER_POLL_MS        idle poll interval          (default 2000)
 *   WORKER_LEASE_SECONDS  lease length                (default 300)
 *   WORKER_MAX_PER_USER   concurrent runs per user    (default 2)
 *   WORKER_MAX_TOTAL      concurrent runs overall     (default 8)
 *   WORKER_SLICE_BUDGET_MS  per-slice wall clock      (default 240000)
 *   WORKER_SLICE_MAX_STEPS  per-slice step cap        (default 30)
 *
 * SIGINT/SIGTERM stop it cleanly: it finishes the slice in flight (so the
 * checkpoint is written and the lease released) and exits.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { claimRun, finishRun, heartbeatRun, reapRuns, queueStats } from '../lib/agent/harness/runs';
import { executeRunSlice } from '../lib/agent/harness/runner';

const int = (name: string, fallback: number) => {
  const raw = (process.env[name] || '').replace(/^["']|["']$/g, '').trim();
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const POLL_MS = int('WORKER_POLL_MS', 2000);
const LEASE_SECONDS = int('WORKER_LEASE_SECONDS', 300);
const MAX_PER_USER = int('WORKER_MAX_PER_USER', 2);
const MAX_TOTAL = int('WORKER_MAX_TOTAL', 8);
const SLICE_BUDGET_MS = int('WORKER_SLICE_BUDGET_MS', 240_000);
const SLICE_MAX_STEPS = int('WORKER_SLICE_MAX_STEPS', 30);

const WORKER_ID = `worker-${process.pid.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

let stopping = false;
let currentRunId: string | null = null;
const totals = { claimed: 0, completed: 0, queued: 0, dead: 0, failed: 0, cancelled: 0 };

function log(...args: unknown[]) {
  console.log(`[${WORKER_ID}]`, ...args);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function installSignalHandlers() {
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`${signal} received — finishing the current slice then exiting.`);
    log('totals:', JSON.stringify(totals));
    if (!currentRunId) process.exit(0);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

async function main() {
  installSignalHandlers();

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is required.');
    process.exit(1);
  }

  log(
    `starting — poll=${POLL_MS}ms lease=${LEASE_SECONDS}s perUser=${MAX_PER_USER} total=${MAX_TOTAL} ` +
      `slice=${SLICE_BUDGET_MS}ms/${SLICE_MAX_STEPS} steps`
  );

  let reaped = { reapedDeadline: 0, reapedStuck: 0 };
  let ticksSinceStats = 0;

  while (!stopping) {
    // Housekeeping first: kill over-deadline runs and abandoned ones.
    try {
      const result = await reapRuns(admin);
      if (result.reapedDeadline || result.reapedStuck) {
        reaped = result;
        log(`reaped ${result.reapedDeadline} over-deadline and ${result.reapedStuck} abandoned run(s)`);
      }
    } catch (err: any) {
      log('reap failed:', err?.message);
    }

    let run;
    try {
      run = await claimRun(admin, WORKER_ID, LEASE_SECONDS, MAX_PER_USER, MAX_TOTAL);
    } catch (err: any) {
      log('claim failed:', err?.message);
      await sleep(POLL_MS * 5);
      continue;
    }

    if (!run) {
      // Idle: cheap poll, and log queue health occasionally.
      if (++ticksSinceStats >= 30) {
        ticksSinceStats = 0;
        const stats = await queueStats(admin).catch(() => null);
        if (stats && stats.total > 0) log('queue:', JSON.stringify(stats));
      }
      await sleep(POLL_MS);
      continue;
    }

    ticksSinceStats = 0;
    currentRunId = run.id;
    totals.claimed++;
    log(`claimed run ${run.id.slice(0, 8)} (attempt ${run.attempts + 1}/${run.max_attempts})`);

    let result;
    try {
      result = await executeRunSlice(admin, run, {
        worker: WORKER_ID,
        budgetMs: SLICE_BUDGET_MS,
        maxSteps: SLICE_MAX_STEPS,
        onHeartbeat: () => heartbeatRun(admin, run.id, WORKER_ID, LEASE_SECONDS),
      });
    } catch (err: any) {
      result = { status: 'failed' as const, steps: 0, error: String(err?.message || err) };
    }

    try {
      await finishRun(admin, run.id, WORKER_ID, {
        status: result.status,
        checkpoint: (result as any).checkpoint ?? null,
        error: (result as any).error ?? null,
        nextAttemptAt: (result as any).nextAttemptAt ?? null,
        incrementAttempt: (result as any).incrementAttempt ?? false,
      });
    } catch (err: any) {
      log('finish failed (lease may have been stolen):', err?.message);
    }

    totals[result.status as keyof typeof totals] =
      (totals[result.status as keyof typeof totals] || 0) + 1;
    log(
      `run ${run.id.slice(0, 8)} → ${result.status}` +
        ((result as any).error ? `: ${String((result as any).error).slice(0, 160)}` : '')
    );

    currentRunId = null;
    if (result.status === 'queued') {
      // More work in this run, but let other runs breathe: the re-queued run
      // goes to the back (updated_at ordering) before we claim again.
      await sleep(50);
    }
  }

  log('stopped. totals:', JSON.stringify(totals), 'reaped:', JSON.stringify(reaped));
  process.exit(0);
}

main().catch((err) => {
  console.error(`[${WORKER_ID}] fatal:`, err);
  process.exit(1);
});
