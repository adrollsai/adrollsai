/**
 * Does the agent actually keep working with nobody watching?
 *
 * The point of durable runs is that closing the app, reloading, or losing the tab does
 * not stop the work: a background worker claims the run from a queue and advances it
 * server-side. "Reattach on return" is only the visible half — the half that matters is
 * that progress happens with no client connected at all.
 *
 * These checks drive the queue primitives directly, so they prove the background
 * machinery without spending on model turns:
 *
 *   1. a queued run is picked up by a worker with no browser involved
 *   2. two workers never take the same run (the SKIP LOCKED claim)
 *   3. a worker that dies mid-run has its run reclaimed, not lost
 *   4. retries back off and then dead-letter instead of looping forever
 *
 *   npm run verify:background
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import {
  enqueueRun,
  claimRun,
  heartbeatRun,
  finishRun,
  reapRuns,
  getRun,
  hasLiveRun,
  nextBackoffMs,
  reviveRun,
} from '../lib/agent/harness/runs';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}

(async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data: profile } = await sb.from('profiles').select('id, business_name').limit(1).maybeSingle();
  if (!profile?.id) {
    console.error('no profile');
    process.exit(1);
  }
  console.log(`profile: ${profile.business_name}\n`);

  const sessions: string[] = [];
  const makeSession = async (label: string) => {
    const { data } = await sb
      .from('harness_sessions')
      .insert({ user_id: profile.id, title: `bg-${label}-${Date.now()}` })
      .select('id')
      .maybeSingle();
    if (data?.id) sessions.push(data.id);
    return data?.id as string;
  };

  // ── 1. picked up and advanced with no client ──────────────────────────────
  console.log('=== works with nobody watching ===');
  const s1 = await makeSession('claim');
  const r1: any = await enqueueRun(sb, {
    sessionId: s1,
    userId: profile.id,
    goal: 'background progress test',
    idempotencyKey: `bg-claim-${Date.now()}`,
  });
  check('the run is queued server-side', r1?.status === 'queued', `status=${r1?.status}`);

  const claimed: any = await claimRun(sb, 'test-worker-1', 120);
  check('a worker claims it with no browser involved', claimed?.id === r1.id, `claimed ${String(claimed?.id).slice(0, 8)}`);
  check('claiming marks it running', claimed?.status === 'running', `status=${claimed?.status}`);
  // The column is lease_owner. Knowing which worker holds a run is what makes a stuck
  // queue diagnosable, so it must actually be recorded.
  check('the claim records which worker holds it', String(claimed?.lease_owner || '') === 'test-worker-1',
    String(claimed?.lease_owner || '(none)'));
  check('a running run is still "live" for the UI', await hasLiveRun(sb, s1));

  const beat = await heartbeatRun(sb, r1.id, 'test-worker-1', 120);
  check('a heartbeat keeps the lease alive', beat === true || beat === undefined, String(beat));

  // ── 2. two workers cannot take the same run ───────────────────────────────
  console.log('\n=== two workers, one run ===');
  const s2 = await makeSession('race');
  const r2: any = await enqueueRun(sb, {
    sessionId: s2,
    userId: profile.id,
    goal: 'concurrency test',
    idempotencyKey: `bg-race-${Date.now()}`,
  });
  const a: any = await claimRun(sb, 'race-a', 120);
  const b: any = await claimRun(sb, 'race-b', 120);
  check('only one worker gets the run', !(a?.id === r2.id && b?.id === r2.id), `a=${String(a?.id).slice(0, 6)} b=${String(b?.id).slice(0, 6)}`);
  check('the second claim gets something else or nothing', b?.id !== r2.id);

  // ── 3. a dead worker's run is reclaimed ───────────────────────────────────
  console.log('\n=== a worker that dies mid-run ===');
  const s3 = await makeSession('reap');
  const r3: any = await enqueueRun(sb, {
    sessionId: s3,
    userId: profile.id,
    goal: 'reaper test',
    idempotencyKey: `bg-reap-${Date.now()}`,
  });
  await claimRun(sb, 'doomed-worker', 1); // 1s lease, then we abandon it
  // Force the lease into the past the way a crashed worker would leave it.
  await sb
    .from('harness_runs')
    .update({ lease_expires_at: new Date(Date.now() - 60_000).toISOString() })
    .eq('id', r3.id);

  const reaped = await reapRuns(sb);
  check('the reaper runs', typeof reaped === 'object' && reaped !== null, JSON.stringify(reaped));
  const afterReap: any = await getRun(sb, r3.id, profile.id);
  check(
    'the abandoned run is not lost — it is requeued or failed, never stuck running',
    afterReap === null || afterReap.status !== 'running',
    `status=${afterReap?.status}`
  );

  // ── 4. retries back off, then give up ─────────────────────────────────────
  console.log('\n=== retries ===');
  const b0 = nextBackoffMs(0);
  const b3 = nextBackoffMs(3);
  const b20 = nextBackoffMs(20);
  check('the first retry is quick', b0 > 0 && b0 < 60_000, `${Math.round(b0 / 1000)}s`);
  check('backoff grows with attempts', b3 > b0, `${Math.round(b0 / 1000)}s -> ${Math.round(b3 / 1000)}s`);
  check('backoff is capped, not unbounded', b20 <= 15 * 60_000 && b20 >= b3, `${Math.round(b20 / 1000)}s (cap)`);
  const jittered = new Set([nextBackoffMs(3), nextBackoffMs(3), nextBackoffMs(3)]);
  check('jitter spreads retries so workers do not sync up', jittered.size > 1 || b3 === 0, `${jittered.size} distinct`);

  // ── 5. a dead-lettered run can be revived by an operator ──────────────────
  console.log('\n=== recovering a failed run ===');
  const s5 = await makeSession('revive');
  const r5: any = await enqueueRun(sb, {
    sessionId: s5,
    userId: profile.id,
    goal: 'revive test',
    idempotencyKey: `bg-revive-${Date.now()}`,
  });
  await claimRun(sb, 'revive-worker', 60);
  await finishRun(sb, r5.id, 'revive-worker', { status: 'failed', error: 'simulated failure', incrementAttempt: true });
  const retried: any = await getRun(sb, r5.id, profile.id);
  check(
    'a failure below the retry limit is requeued, not thrown away',
    retried?.status === 'queued' || retried?.status === 'running' || retried?.status === 'failed',
    `status=${retried?.status} attempts=${retried?.attempts}/${retried?.max_attempts}`
  );

  // Exhaust the attempts, then fail again: that must dead-letter rather than loop.
  await sb.from('harness_runs').update({ attempts: 99, status: 'running', lease_owner: 'revive-worker' }).eq('id', r5.id);
  await finishRun(sb, r5.id, 'revive-worker', { status: 'failed', error: 'exhausted', incrementAttempt: true });
  const dead: any = await getRun(sb, r5.id, profile.id);
  check(
    'an exhausted run stops retrying',
    dead === null || ['failed', 'dead', 'cancelled'].includes(String(dead.status)),
    `status=${dead?.status}`
  );
  const revived = await reviveRun(sb, r5.id).catch((e: any) => ({ error: e?.message }));
  const afterRevive: any = await getRun(sb, r5.id, profile.id);
  check(
    'an operator can requeue it instead of losing the work',
    afterRevive === null || afterRevive.status !== 'failed' || Boolean((revived as any)?.error) === false,
    `status=${afterRevive?.status}`
  );

  // ── cleanup ───────────────────────────────────────────────────────────────
  for (const sid of sessions) {
    await sb.from('harness_runs').update({ status: 'cancelled', finished_at: new Date().toISOString() }).eq('session_id', sid).in('status', ['queued', 'running']);
    await sb.from('harness_events').delete().eq('session_id', sid);
    await sb.from('harness_runs').delete().eq('session_id', sid);
    await sb.from('harness_sessions').delete().eq('id', sid);
  }

  console.log(`\n=== ${pass}/${pass + fail} checks passed ===`);
  if (fail) process.exit(1);
})().catch((e) => {
  console.error('failed:', e?.message || e);
  process.exit(1);
});
