/**
 * Live verification of the hardened run engine.
 *
 * Covers the five production gaps that were closed:
 *   1. exactly-once side effects (idempotency ledger + wrapper)
 *   2. retries with exponential backoff, max attempts, dead-letter, revive
 *   3. per-user concurrency limits inside the atomic claim
 *   4. context compaction (guards + a real forced compaction)
 *   5. (realtime publication is asserted separately by the client wiring)
 *
 * Run: npm run verify:hardening
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { createSession, deleteSession, __resetAvailabilityCacheForTests } from '../lib/agent/harness/store';
import {
  enqueueRun,
  claimRun,
  finishRun,
  getRun,
  reviveRun,
  beginToolCall,
  finishToolCall,
  nextBackoffMs,
  __resetRunsAvailabilityCacheForTests,
} from '../lib/agent/harness/runs';
import { isSideEffecting, idempotencyKey, wrapToolsWithIdempotency, countToolOccurrences } from '../lib/agent/harness/idempotency';
import { maybeCompact, estimateChars, COMPACT_CHAR_THRESHOLD } from '../lib/agent/harness/compaction';

const MARKER = '__verify_hardening__';
const WORKER = 'verify-hardening-worker';

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

async function cleanup() {
  const { data: sessions } = await admin.from('harness_sessions').select('id').eq('workspace_id', MARKER);
  for (const s of sessions || []) {
    await admin.from('harness_tool_calls').delete().eq('session_id', s.id);
    await admin.from('harness_runs').delete().eq('session_id', s.id);
    await admin.from('harness_events').delete().eq('session_id', s.id);
    await admin.from('harness_sessions').delete().eq('id', s.id);
  }
}

async function main() {
  const { data: profiles } = await admin.from('profiles').select('id').limit(1);
  const userId = profiles![0].id as string;

  await cleanup();
  __resetAvailabilityCacheForTests();
  __resetRunsAvailabilityCacheForTests();

  // ── classification & key derivation (pure) ──────────────────────────────
  console.log('\n▸ side-effect classification');
  check('send_* is side-effecting', isSideEffecting('send_single_whatsapp_message'));
  check('create_* is side-effecting', isSideEffecting('create_lead'));
  check('launch_* is side-effecting', isSideEffecting('launch_bulk_calling_campaign'));
  check('meta campaign creation is side-effecting', isSideEffecting('meta_mcp_create_campaign'));
  check('voice dispatch is side-effecting', isSideEffecting('nobogent_voice_dispatch_call'));
  check('list_* is read-only', !isSideEffecting('list_user_files'));
  check('get_* is read-only', !isSideEffecting('get_crm_metrics'));
  check('query_* is read-only', !isSideEffecting('query_leads'));
  check('unknown tool is treated as read-only', !isSideEffecting('some_future_tool'));

  console.log('\n▸ idempotency keys are stable and order-insensitive');
  const k1 = idempotencyKey('run-1', 'send_single_whatsapp_message', { to: '+91', body: 'hi' });
  const k2 = idempotencyKey('run-1', 'send_single_whatsapp_message', { body: 'hi', to: '+91' });
  const k3 = idempotencyKey('run-1', 'send_single_whatsapp_message', { to: '+91', body: 'bye' });
  const k4 = idempotencyKey('run-2', 'send_single_whatsapp_message', { to: '+91', body: 'hi' });
  check('key is independent of key order', k1 === k2, { k1, k2 });
  check('different input → different key', k1 !== k3);
  check('different run → different key', k1 !== k4);

  // ── backoff policy ──────────────────────────────────────────────────────
  console.log('\n▸ exponential backoff with jitter and a cap');
  const samples = [0, 1, 2, 3, 4].map((a) => nextBackoffMs(a));
  check('backoff increases with attempts', samples[0] < samples[2] && samples[2] < samples[4], samples);
  check('first retry is ~5s', samples[0] >= 4000 && samples[0] <= 6100, samples[0]);
  const capped = nextBackoffMs(30);
  check('backoff is capped at ~5 min', capped <= 300_000, capped);
  const jitter = new Set([nextBackoffMs(3), nextBackoffMs(3), nextBackoffMs(3)]);
  check('jitter varies the delay', jitter.size > 1, [...jitter]);

  const session = await createSession(admin, userId, { title: 'hardening', workspaceId: MARKER });
  if (!session) throw new Error('could not create session');

  // ── ledger: exactly-once ────────────────────────────────────────────────
  console.log('\n▸ tool ledger (live)');
  const run = await enqueueRun(admin, { sessionId: session.id, userId, goal: 'ledger test' });
  const inputHash = idempotencyKey(run!.id, 'send_single_whatsapp_message', { to: '+911', body: 'one' });

  const first = await beginToolCall(admin, {
    runId: run!.id,
    sessionId: session.id,
    toolName: 'send_single_whatsapp_message',
    inputHash,
    input: { to: '+911', body: 'one' },
  });
  check('first call is fresh', first.state === 'fresh', first.state);
  check('ledger row created', Boolean(first.record?.id), first.record?.id);

  const freshRowId = first.record!.id;
  const whileRunning = await beginToolCall(admin, {
    runId: run!.id,
    sessionId: session.id,
    toolName: 'send_single_whatsapp_message',
    inputHash,
    input: { to: '+911', body: 'one' },
  });
  check('a second concurrent attempt sees in_flight', whileRunning.state === 'in_flight', whileRunning.state);

  await finishToolCall(admin, freshRowId, { status: 'completed', output: { success: true, messageId: 'wamid.123' } });
  const replay = await beginToolCall(admin, {
    runId: run!.id,
    sessionId: session.id,
    toolName: 'send_single_whatsapp_message',
    inputHash,
    input: { to: '+911', body: 'one' },
  });
  check('after completion it replays', replay.state === 'completed', replay.state);
  check('the recorded output is returned', (replay as any).record?.output?.messageId === 'wamid.123', (replay as any).record?.output);

  // Stale "started" with no result = the dangerous partial-execution case.
  const staleHash = idempotencyKey(run!.id, 'meta_mcp_create_campaign', { name: 'x' });
  const staleLookup = await beginToolCall(admin, {
    runId: run!.id,
    sessionId: session.id,
    toolName: 'meta_mcp_create_campaign',
    inputHash: staleHash,
    input: { name: 'x' },
  });
  await admin
    .from('harness_tool_calls')
    .update({ created_at: new Date(Date.now() - 60 * 60_000).toISOString() })
    .eq('id', staleLookup.record!.id);
  const stale = await beginToolCall(admin, {
    runId: run!.id,
    sessionId: session.id,
    toolName: 'meta_mcp_create_campaign',
    inputHash: staleHash,
    input: { name: 'x' },
  });
  check('a stale unfinished call is flagged unknown_outcome', stale.state === 'unknown_outcome', stale.state);

  console.log('\n▸ idempotent tool wrapper');
  let executions = 0;
  const fakeTools = {
    send_single_whatsapp_message: {
      description: 'fake',
      execute: async () => {
        executions++;
        return { success: true, messageId: `wamid.${executions}` };
      },
    },
    list_user_files: {
      description: 'fake read',
      execute: async () => {
        executions += 1000;
        return { files: [] };
      },
    },
  };
  const mkWrapper = () =>
    wrapToolsWithIdempotency(fakeTools as any, {
      supabase: admin,
      runId: run!.id,
      sessionId: session.id,
      occurrences: new Map(),
    });

  const callInput = { to: '+912', body: 'dedupe me' };

  // Slice A: the call runs for real.
  const sliceA = mkWrapper();
  const r1: any = await sliceA.send_single_whatsapp_message.execute(callInput, {});
  check('first execution runs for real', executions === 1, executions);
  check('first result is real', r1.messageId === 'wamid.1' && !r1.replayed, r1);

  // Slice B = a retry with the same baseline (nothing new in the checkpoint).
  // It must replay, not fire again.
  const sliceB = mkWrapper();
  const r2: any = await sliceB.send_single_whatsapp_message.execute(callInput, {});
  check('a retried slice replays instead of re-executing', executions === 1, executions);
  check('replayed result matches and is flagged', r2.messageId === 'wamid.1' && r2.replayed === true, r2);

  // A legitimately repeated identical call in ONE slice is occurrence 2 → runs.
  executions = 0;
  const sliceC = mkWrapper();
  const repeat = { to: '+913', body: 'send twice' };
  await sliceC.send_single_whatsapp_message.execute(repeat, {});
  await sliceC.send_single_whatsapp_message.execute(repeat, {});
  check('two identical calls in one slice both execute', executions === 2, executions);

  // Read-only tools are never deduped.
  executions = 0;
  const sliceD = mkWrapper();
  await sliceD.list_user_files.execute({}, {});
  await sliceD.list_user_files.execute({}, {});
  check('read-only tool is NOT deduped', executions === 2000, executions);

  console.log('\n▸ occurrence-aware keys');
  const occ1 = idempotencyKey('run-1', 'send_single_whatsapp_message', { a: 1 }, 1);
  const occ2 = idempotencyKey('run-1', 'send_single_whatsapp_message', { a: 1 }, 2);
  check('different occurrence → different key', occ1 !== occ2, { occ1, occ2 });
  const baseline = countToolOccurrences([
    { role: 'assistant', content: [{ type: 'tool-call', toolName: 'send_single_whatsapp_message', input: { a: 1 } }] },
    { role: 'assistant', content: [{ type: 'tool-call', toolName: 'send_single_whatsapp_message', input: { a: 1 } }] },
  ]);
  check('baseline counts prior occurrences from the checkpoint', baseline.size === 1 && [...baseline.values()][0] === 2, [...baseline.entries()]);

  // ── retries, dead-letter, revive ────────────────────────────────────────
  console.log('\n▸ retry scheduling and dead-letter (live)');
  // Clear this session's runs so the queue holds only what this section owns.
  await admin.from('harness_runs').delete().eq('session_id', session.id);
  await enqueueRun(admin, { sessionId: session.id, userId, goal: 'retry test' });

  // Claim up to a few times and record what we got — other tenants' runs may
  // also be queued, so assert on the claimed set rather than assuming.
  const claimedIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const c = await claimRun(admin, WORKER, 300, 5);
    if (!c) break;
    claimedIds.push(c.id);
  }
  check('at least one run claimed for the retry test', claimedIds.length > 0, claimedIds);

  const target = claimedIds[0];
  const future = new Date(Date.now() + 60_000).toISOString();
  const scheduled = await finishRun(admin, target, WORKER, {
    status: 'queued',
    error: 'transient provider error',
    nextAttemptAt: future,
    incrementAttempt: true,
  });
  check('retry scheduled', scheduled?.status === 'queued', scheduled?.status);
  check('attempt counted', scheduled?.attempts === 1, scheduled?.attempts);
  // Postgres normalises timestamptz formatting, so compare instants, not strings.
  const sameInstant = (a: string | null, b: string) =>
    Boolean(a) && Math.abs(new Date(a!).getTime() - new Date(b).getTime()) < 1000;
  check('backoff gate stored', sameInstant(scheduled?.next_attempt_at ?? null, future), scheduled?.next_attempt_at);

  const blocked = await claimRun(admin, WORKER, 300, 5);
  check('the gated run is not re-claimed early', blocked?.id !== target, blocked?.id ?? null);

  await admin.from('harness_runs').update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).eq('id', target);
  const reclaimIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const c = await claimRun(admin, WORKER, 300, 5);
    if (!c) break;
    reclaimIds.push(c.id);
  }
  check('claimable once the backoff elapses', reclaimIds.includes(target), reclaimIds);

  const dead = await finishRun(admin, target, WORKER, {
    status: 'dead',
    error: 'gave up',
    incrementAttempt: true,
  });
  check('dead-lettered', dead?.status === 'dead', dead?.status);
  check('dead_at stamped', Boolean(dead?.dead_at), dead?.dead_at);
  check('finished_at stamped', Boolean(dead?.finished_at));
  const afterDead = await claimRun(admin, WORKER, 300, 5);
  check('dead run is not claimable', afterDead?.id !== target, afterDead?.id ?? null);

  const revived = await reviveRun(admin, target);
  check('revive returns it to the queue', revived?.status === 'queued', revived?.status);
  check('revive resets attempts', revived?.attempts === 0, revived?.attempts);
  check('revive clears the dead marker', revived?.dead_at === null, revived?.dead_at);

  // ── per-user concurrency limit ──────────────────────────────────────────
  console.log('\n▸ per-user concurrency limit (live)');
  await admin.from('harness_runs').delete().eq('session_id', session.id);
  const burst = [];
  for (let i = 0; i < 3; i++) {
    burst.push(await enqueueRun(admin, { sessionId: session.id, userId, goal: `burst ${i}` }));
  }
  const firstClaim = await claimRun(admin, 'limit-worker', 300, 1);
  check('one run claimed at limit=1', Boolean(firstClaim), firstClaim?.id ?? null);
  const secondClaim = await claimRun(admin, 'limit-worker-2', 300, 1);
  check('a second concurrent run is refused at limit=1', secondClaim === null, secondClaim?.id ?? null);
  const thirdClaim = await claimRun(admin, 'limit-worker-3', 300, 2);
  check('allowed once the limit is 2', Boolean(thirdClaim), thirdClaim?.id ?? null);

  // ── compaction ──────────────────────────────────────────────────────────
  console.log('\n▸ context compaction');
  const small = [{ role: 'user', content: 'hi' }] as any;
  const noop = await maybeCompact(small, { thresholdChars: COMPACT_CHAR_THRESHOLD });
  check('small conversation is untouched', noop.compacted === false && noop.messages === small);

  const few = Array.from({ length: 5 }, (_, i) => ({ role: 'user', content: `m${i}` })) as any;
  const tooFew = await maybeCompact(few, { thresholdChars: 10 });
  check('too few messages to compact', tooFew.compacted === false, tooFew.messages.length);

  const big = Array.from({ length: 30 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Message ${i}: ` + 'detail '.repeat(60),
  })) as any;
  check('big conversation is over the size threshold', estimateChars(big) > 10_000, estimateChars(big));
  const compacted = await maybeCompact(big, { thresholdChars: 5_000, keepRecent: 6 });
  check('big conversation was compacted', compacted.compacted === true, {
    before: compacted.beforeChars,
    after: compacted.afterChars,
  });
  check('it got smaller', compacted.afterChars < compacted.beforeChars, {
    before: compacted.beforeChars,
    after: compacted.afterChars,
  });
  check('recent messages kept verbatim', compacted.messages.length === 7, compacted.messages.length);
  check('summary bridge inserted first', String((compacted.messages[0] as any).content?.[0]?.text || '').includes('Compacted earlier context'));

  await cleanup();
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
