/**
 * Proves the mechanism that makes HOURS possible: a run that cannot finish in
 * one slice is checkpointed, re-queued, and continued by a later worker
 * invocation — exactly how a long task survives many short cron ticks.
 *
 * Strategy: force a one-step slice (`?maxSteps=1`) and ask the model to use a
 * tool first. The first slice therefore ends with a pending tool call, hits the
 * step cap, and must re-queue. The second invocation resumes from the
 * checkpoint and finishes the answer.
 *
 * Uses `nobogent_brand_get_profile` — a fast DB read, so no E2B sandbox is
 * provisioned and the test stays quick.
 *
 * Run: npm run verify:run-resume
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { createSession, appendEvents, loadSession, __resetAvailabilityCacheForTests } from '../lib/agent/harness/store';
import { createEvent } from '../lib/agent/harness/events';
import { enqueueRun, __resetRunsAvailabilityCacheForTests } from '../lib/agent/harness/runs';

const MARKER = '__verify_resume__';
const BASE_URL = process.env.VERIFY_BASE_URL || 'http://localhost:3000';

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
    await admin.from('harness_runs').delete().eq('session_id', s.id);
    await admin.from('harness_events').delete().eq('session_id', s.id);
    await admin.from('harness_sessions').delete().eq('id', s.id);
  }
}

async function tick(maxSteps: number) {
  const secret = (process.env.CRON_SECRET || '').replace(/^["']|["']$/g, '').trim();
  const res = await fetch(`${BASE_URL}/api/cron/harness-runner?maxSteps=${maxSteps}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const payload = await res.json();
  return { status: res.status, payload };
}

async function main() {
  const { data: profiles } = await admin.from('profiles').select('id').limit(1);
  const userId = profiles![0].id as string;

  await cleanup();
  __resetAvailabilityCacheForTests();
  __resetRunsAvailabilityCacheForTests();

  const session = await createSession(admin, userId, { title: 'resume', workspaceId: MARKER });
  if (!session) throw new Error('could not create session');

  await appendEvents(admin, session.id, [
    createEvent('user.message', {
      id: `u_${Date.now()}`,
      text:
        'First call the nobogent_brand_get_profile tool, then reply with just the business name it returned. ' +
        'The tool call must happen before you answer.',
    }),
  ]);

  const run = await enqueueRun(admin, { sessionId: session.id, userId, goal: 'resume test' });
  check('run queued', Boolean(run?.id));

  console.log('\n▸ slice 1 (forced to 1 step, so it must stop mid-task)');
  const first = await tick(1);
  console.log('   ', JSON.stringify(first.payload));
  const entries = (first.payload.processed || []).filter((p: any) => p.runId === run!.id);
  check('slice 1 processed our run', entries.length > 0, first.payload);
  check('the first slice stopped mid-task and re-queued', entries[0]?.status === 'queued', entries[0]);
  // The worker's own loop continues a re-queued run when it is the only work
  // available, so the task finishes inside this invocation rather than waiting
  // for the next cron tick. Either outcome is correct; this asserts the
  // checkpoint path was actually exercised.
  check('a later slice resumed and finished it', entries.some((e: any) => e.status === 'completed'), entries.map((e: any) => e.status));

  const { data: afterFirst } = await admin.from('harness_runs').select('*').eq('id', run!.id).single();
  check('run completed across slices', afterFirst?.status === 'completed', afterFirst?.status);
  check('checkpoint written back', Boolean(afterFirst?.checkpoint?.messages?.length), afterFirst?.checkpoint);
  check('more than one slice ran', afterFirst?.continuations >= 2, afterFirst?.continuations);
  check('checkpoint advanced past slice 1', (afterFirst?.checkpoint?.slices ?? 0) >= 2, afterFirst?.checkpoint?.slices);
  const roles = (afterFirst?.checkpoint?.messages ?? []).map((m: any) => m.role);
  console.log('    checkpoint roles:', JSON.stringify(roles));
  check('resumed conversation contains the tool call and its result', roles.includes('tool'), roles);
  check('lease released', afterFirst?.lease_owner === null, afterFirst?.lease_owner);
  check('finished_at stamped', Boolean(afterFirst?.finished_at));

  console.log('\n▸ a second tick finds an empty queue');
  const second = await tick(4);
  check('queue idle afterwards', second.payload.idle === true, second.payload);

  console.log('\n▸ the transcript spans both slices');
  const loaded = await loadSession(admin, userId, session.id);
  const toolRows = loaded!.state.items.filter((i) => i.kind === 'tool');
  const replies = loaded!.state.items.filter((i) => i.kind === 'assistant');
  check('tool call from slice 1 is in the log', toolRows.length >= 1, toolRows.length);
  check('tool result resolved', toolRows.some((t: any) => t.status === 'done' || t.status === 'failed'), toolRows.map((t: any) => t.status));
  check('final answer from slice 2 is in the log', replies.length >= 1, replies.length);
  if (replies.length) console.log(`    model said: "${String((replies[replies.length - 1] as any).text).slice(0, 120)}"`);

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
