/**
 * Live verification of the production tier of the run engine.
 *
 * Covers: idempotent enqueue, priority ordering, per-run deadline, the reaper
 * (over-deadline and abandoned runs), the global concurrency ceiling, and the
 * operator queue-stats view.
 *
 * Run: npm run verify:production
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { createSession, __resetAvailabilityCacheForTests } from '../lib/agent/harness/store';
import {
  enqueueRun,
  claimRun,
  finishRun,
  reapRuns,
  queueStats,
  __resetRunsAvailabilityCacheForTests,
} from '../lib/agent/harness/runs';

const MARKER = '__verify_production__';
const WORKER = 'verify-prod-worker';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  checks++;
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}${detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`);
  }
}

async function cleanupSession(sessionId?: string) {
  if (sessionId) {
    await admin.from('harness_tool_calls').delete().eq('session_id', sessionId);
    await admin.from('harness_runs').delete().eq('session_id', sessionId);
    await admin.from('harness_events').delete().eq('session_id', sessionId);
    await admin.from('harness_sessions').delete().eq('id', sessionId);
  }
  const { data } = await admin.from('harness_sessions').select('id').eq('workspace_id', MARKER);
  for (const s of data || []) await cleanupSession(s.id);
}

/** Mark every run finished so the queue is empty and ceilings are measurable. */
async function drainQueue() {
  await admin.from('harness_runs').update({ status: 'completed', lease_owner: null, lease_expires_at: null }).neq('status', 'completed');
}

async function main() {
  const { data: profiles } = await admin.from('profiles').select('id').limit(1);
  const userId = profiles![0].id as string;

  await cleanupSession();
  __resetAvailabilityCacheForTests();
  __resetRunsAvailabilityCacheForTests();

  const session = await createSession(admin, userId, { title: 'production', workspaceId: MARKER });
  if (!session) throw new Error('could not create session');

  // ── idempotent enqueue ──────────────────────────────────────────────────
  console.log('\n▸ idempotent enqueue (a double-submit is one run)');
  const key = `verify-key-${Date.now()}`;
  const first = await enqueueRun(admin, { sessionId: session.id, userId, goal: 'g', idempotencyKey: key });
  const second = await enqueueRun(admin, { sessionId: session.id, userId, goal: 'g', idempotencyKey: key });
  check('both submits return a run', Boolean(first && second));
  check('they are the SAME run', first?.id === second?.id, { first: first?.id, second: second?.id });
  const { count: keyedCount } = await admin
    .from('harness_runs')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', session.id)
    .eq('idempotency_key', key);
  check('only one row exists for that key', keyedCount === 1, keyedCount);

  const noKeyA = await enqueueRun(admin, { sessionId: session.id, userId, goal: 'no key' });
  const noKeyB = await enqueueRun(admin, { sessionId: session.id, userId, goal: 'no key' });
  check('without a key, two different runs are created', noKeyA?.id !== noKeyB?.id);

  // ── priority ordering ───────────────────────────────────────────────────
  console.log('\n▸ priority ordering');
  await admin.from('harness_runs').delete().eq('session_id', session.id);
  const low = await enqueueRun(admin, { sessionId: session.id, userId, goal: 'low', priority: 0 });
  const high = await enqueueRun(admin, { sessionId: session.id, userId, goal: 'high', priority: 9 });
  check('low created before high', Boolean(low && high));
  const claimedHigh = await claimRun(admin, WORKER, 300, 10, 10);
  check('the high-priority run is claimed first', claimedHigh?.id === high?.id, {
    got: claimedHigh?.id,
    high: high?.id,
    low: low?.id,
  });

  // ── deadline + reaper ───────────────────────────────────────────────────
  console.log('\n▸ per-run deadline and the reaper');
  await drainQueue();
  await admin.from('harness_runs').delete().eq('session_id', session.id);

  const expired = await enqueueRun(admin, {
    sessionId: session.id,
    userId,
    goal: 'expired',
    deadlineAt: new Date(Date.now() - 60_000).toISOString(),
  });
  check('a past-deadline run is created', Boolean(expired?.id));

  const claimExpired = await claimRun(admin, WORKER, 300, 10, 10);
  check('a past-deadline run is never claimed', claimExpired?.id !== expired?.id, claimExpired?.id ?? null);

  const reaped = await reapRuns(admin);
  check('the reaper ran', Boolean(reaped));
  const { data: expiredRow } = await admin.from('harness_runs').select('status, dead_at').eq('id', expired!.id).single();
  check('the over-deadline run was dead-lettered', expiredRow?.status === 'dead', expiredRow?.status);
  check('dead_at stamped by the reaper', Boolean(expiredRow?.dead_at));

  // Abandoned run: worker died with its retry budget spent.
  await drainQueue();
  await admin.from('harness_runs').delete().eq('session_id', session.id);
  const abandoned = await enqueueRun(admin, { sessionId: session.id, userId, goal: 'abandoned' });
  await admin
    .from('harness_runs')
    .update({
      status: 'running',
      attempts: 5,
      max_attempts: 5,
      lease_owner: 'dead-worker',
      lease_expires_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    })
    .eq('id', abandoned!.id);
  await reapRuns(admin);
  const { data: abandonedRow } = await admin.from('harness_runs').select('status, error').eq('id', abandoned!.id).single();
  check('an abandoned run past its retry budget is dead-lettered', abandonedRow?.status === 'dead', abandonedRow?.status);

  // A run with retries left must NOT be reaped — it should be reclaimed.
  await admin.from('harness_runs').delete().eq('session_id', session.id);
  const retryable = await enqueueRun(admin, { sessionId: session.id, userId, goal: 'retryable' });
  await admin
    .from('harness_runs')
    .update({
      status: 'running',
      attempts: 1,
      max_attempts: 5,
      lease_owner: 'dead-worker',
      lease_expires_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    })
    .eq('id', retryable!.id);
  await reapRuns(admin);
  const { data: retryableRow } = await admin.from('harness_runs').select('status').eq('id', retryable!.id).single();
  check('a run with retries left survives the reaper', retryableRow?.status === 'running', retryableRow?.status);
  const reclaimed = await claimRun(admin, 'rescuer', 300, 10, 10);
  check('and is reclaimed by another worker', reclaimed?.id === retryable!.id, reclaimed?.id);

  // ── global concurrency ceiling ──────────────────────────────────────────
  console.log('\n▸ global concurrency ceiling');
  await drainQueue();
  await admin.from('harness_runs').delete().eq('session_id', session.id);
  await enqueueRun(admin, { sessionId: session.id, userId, goal: 'ceiling 1' });
  await enqueueRun(admin, { sessionId: session.id, userId, goal: 'ceiling 2' });

  const firstAtCeiling = await claimRun(admin, 'ceiling-worker-1', 300, 10, 1);
  check('one run claimed at maxTotal=1', Boolean(firstAtCeiling), firstAtCeiling?.id ?? null);
  const secondAtCeiling = await claimRun(admin, 'ceiling-worker-2', 300, 10, 1);
  check('a second run is refused at maxTotal=1', secondAtCeiling === null, secondAtCeiling?.id ?? null);
  const withRoom = await claimRun(admin, 'ceiling-worker-3', 300, 10, 2);
  check('allowed once maxTotal=2', Boolean(withRoom), withRoom?.id ?? null);

  // ── observability ───────────────────────────────────────────────────────
  console.log('\n▸ queue stats');
  const stats = await queueStats(admin);
  check('stats returned', Boolean(stats), stats);
  check('stats expose the state counts', typeof stats?.queued === 'number' && typeof stats?.dead === 'number', stats);
  check('stats expose backlog age', typeof stats?.oldest_queued_age_seconds === 'number', stats?.oldest_queued_age_seconds);
  check('stats expose expired leases', typeof stats?.expired_leases === 'number', stats?.expired_leases);

  await cleanupSession(session.id);
}

(async () => {
  try {
    await main();
  } catch (err: any) {
    failures++;
    console.error('\nFATAL: ' + (err?.message || err));
  } finally {
    await cleanupSession().catch(() => {});
  }
  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
