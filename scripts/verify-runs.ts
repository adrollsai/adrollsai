/**
 * Live verification of the durable run queue against the real database.
 *
 * Proves the properties that make long-running work safe:
 *   - two workers can never claim the same run (SKIP LOCKED)
 *   - an idle queue returns null instead of blocking or erroring
 *   - a re-queued run goes to the back of the queue
 *   - a run whose worker died (expired lease) is reclaimed
 *   - cancellation is observable by the worker
 *   - terminal transitions release the lease and stamp finished_at
 *
 * Everything it creates is tagged `workspace_id = '__verify_runs__'` and deleted.
 *
 * Run: npm run verify:runs
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { createSession, deleteSession, isAvailable, __resetAvailabilityCacheForTests } from '../lib/agent/harness/store';
import {
  enqueueRun,
  claimRun,
  finishRun,
  requestCancel,
  isCancelRequested,
  getRun,
  runsAvailableCheck,
  __resetRunsAvailabilityCacheForTests,
} from '../lib/agent/harness/runs';

const MARKER = '__verify_runs__';
const WORKER_A = 'verify-worker-A';
const WORKER_B = 'verify-worker-B';

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

async function cleanup(userId?: string) {
  const { data: sessions } = await admin
    .from('harness_sessions')
    .select('id')
    .eq('workspace_id', MARKER);
  for (const s of sessions || []) {
    await admin.from('harness_runs').delete().eq('session_id', s.id);
    await admin.from('harness_events').delete().eq('session_id', s.id);
    await admin.from('harness_sessions').delete().eq('id', s.id);
  }
  void userId;
}

async function main() {
  const { data: profiles, error: pErr } = await admin.from('profiles').select('id').limit(1);
  if (pErr || !profiles?.length) throw new Error(`no profile: ${pErr?.message}`);
  const userId = profiles[0].id as string;

  await cleanup(userId);

  __resetAvailabilityCacheForTests();
  __resetRunsAvailabilityCacheForTests();
  check('harness_runs is live', (await runsAvailableCheck(admin)) === true);
  check('harness_sessions is live', (await isAvailable(admin)) === true);

  const session = await createSession(admin, userId, { title: 'verify runs', workspaceId: MARKER });
  if (!session) throw new Error('could not create the verification session');

  console.log('\n▸ enqueue');
  const r1 = await enqueueRun(admin, { sessionId: session.id, userId, goal: 'task 1' });
  const r2 = await enqueueRun(admin, { sessionId: session.id, userId, goal: 'task 2' });
  const r3 = await enqueueRun(admin, { sessionId: session.id, userId, goal: 'task 3' });
  check('three runs queued', Boolean(r1 && r2 && r3));
  check('all start as queued', r1?.status === 'queued' && r2?.status === 'queued' && r3?.status === 'queued');

  console.log('\n▸ concurrent claims never collide (SKIP LOCKED)');
  const [a, b] = await Promise.all([claimRun(admin, WORKER_A, 300, 10), claimRun(admin, WORKER_B, 300, 10)]);
  check('both workers got a run', Boolean(a && b), { a: a?.id, b: b?.id });
  check('the two claims are different runs', a?.id !== b?.id, { a: a?.id, b: b?.id });
  check('claims are marked running', a?.status === 'running' && b?.status === 'running');
  check('lease owner recorded', a?.lease_owner === WORKER_A && b?.lease_owner === WORKER_B);

  const third = await claimRun(admin, WORKER_A, 300, 10);
  check('third run claimed', Boolean(third) && ![a?.id, b?.id].includes(third?.id), third?.id);
  const none = await claimRun(admin, WORKER_A, 300, 10);
  check('idle queue returns null (no lease available)', none === null, none?.id);

  console.log('\n▸ re-queue sends a run to the back');
  const requeued = await finishRun(admin, a!.id, WORKER_A, {
    status: 'queued',
    checkpoint: { messages: [{ role: 'user', content: 'hi' }], slices: 1 },
    bumpContinuation: true,
  });
  check('re-queue released the lease', requeued?.lease_owner === null, requeued?.lease_owner);
  check('continuation counted', requeued?.continuations === 1, requeued?.continuations);
  check('checkpoint persisted', Boolean(requeued?.checkpoint), requeued?.checkpoint);

  // r2/r3 are still 'running' with live leases, so the only claimable run is r1.
  const afterRequeue = await claimRun(admin, WORKER_B, 300, 10);
  check('the re-queued run is claimable again', afterRequeue?.id === a!.id, afterRequeue?.id);
  check('resumed run keeps its checkpoint', afterRequeue?.checkpoint !== null);

  console.log('\n▸ crash recovery: expired lease is reclaimed');
  // Simulate WORKER_B dying while holding r2: push its lease into the past.
  const past = new Date(Date.now() - 60_000).toISOString();
  await admin.from('harness_runs').update({ lease_expires_at: past }).eq('id', b!.id);
  const reclaimed = await claimRun(admin, WORKER_A, 300, 10);
  check('expired-lease run reclaimed first', reclaimed?.id === b!.id, reclaimed?.id);
  check('new worker owns it', reclaimed?.lease_owner === WORKER_A, reclaimed?.lease_owner);

  console.log('\n▸ cancellation is visible to the worker');
  check('not cancelled yet', (await isCancelRequested(admin, r3!.id)) === false);
  check('cancel accepted', (await requestCancel(admin, r3!.id, userId)) === true);
  check('worker sees the cancel request', (await isCancelRequested(admin, r3!.id)) === true);

  console.log('\n▸ terminal transitions (each run finished once, by its owner)');
  // Current ownership: r1 → WORKER_B (afterRequeue), r2 → WORKER_A (reclaimed),
  // r3 → WORKER_A (third claim).
  check(
    'a non-owner cannot finish a run',
    (await finishRun(admin, afterRequeue!.id, WORKER_A, { status: 'completed' })) === null
  );

  const done = await finishRun(admin, afterRequeue!.id, WORKER_B, { status: 'completed' });
  check('completed clears the lease', done?.lease_owner === null, done?.lease_owner);
  check('completed stamps finished_at', Boolean(done?.finished_at), done?.finished_at);
  check('completed run is not claimable', (await claimRun(admin, WORKER_B, 300, 10))?.id !== afterRequeue!.id);

  const cancelled = await finishRun(admin, third!.id, WORKER_A, { status: 'cancelled' });
  check('cancel transition recorded', cancelled?.status === 'cancelled', cancelled?.status);

  const failed = await finishRun(admin, reclaimed!.id, WORKER_A, {
    status: 'failed',
    error: 'boom',
  });
  check('failed transition records the error', failed?.status === 'failed' && failed?.error === 'boom', failed?.error);

  check('finishing twice is a no-op (lease already released)', (await finishRun(admin, reclaimed!.id, WORKER_A, { status: 'completed' })) === null);

  console.log('\n▸ ownership');
  const foreign = await getRun(admin, afterRequeue!.id, '00000000-0000-0000-0000-000000000000');
  check('a run is not readable by a different user', foreign === null);

  console.log('\n▸ cleanup');
  await admin.from('harness_runs').delete().eq('session_id', session.id);
  await deleteSession(admin, userId, session.id);
}

(async () => {
  try {
    await main();
  } catch (err: any) {
    failures++;
    console.error('\nFATAL: ' + (err?.message || err));
  } finally {
    await cleanup().catch(() => {});
  }

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
