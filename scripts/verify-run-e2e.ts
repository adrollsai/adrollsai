/**
 * End-to-end test of durable execution against the live stack.
 *
 * Creates a session, appends a user message, queues a run, then invokes the
 * worker exactly as Vercel cron would. Asserts that the worker claimed it, the
 * model produced a reply, and the run reached a terminal state with the
 * transcript written to the event log.
 *
 * Requires the dev server (or a deployment) at BASE_URL and CRON_SECRET.
 * Run: npm run verify:run-e2e
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { createSession, deleteSession, appendEvents, loadSession, __resetAvailabilityCacheForTests } from '../lib/agent/harness/store';
import { createEvent } from '../lib/agent/harness/events';
import { enqueueRun, __resetRunsAvailabilityCacheForTests } from '../lib/agent/harness/runs';

const MARKER = '__verify_e2e__';
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

async function main() {
  const secret = (process.env.CRON_SECRET || '').replace(/^["']|["']$/g, '').trim();
  if (!secret) throw new Error('CRON_SECRET missing');

  const { data: profiles } = await admin.from('profiles').select('id').limit(1);
  const userId = profiles![0].id as string;

  await cleanup();
  __resetAvailabilityCacheForTests();
  __resetRunsAvailabilityCacheForTests();

  const session = await createSession(admin, userId, { title: 'e2e', workspaceId: MARKER });
  if (!session) throw new Error('could not create session');
  console.log(`session ${session.id.slice(0, 8)} on ${BASE_URL}`);

  await appendEvents(admin, session.id, [
    createEvent('user.message', {
      id: `u_${Date.now()}`,
      text: 'Reply with exactly the single token PIPELINE_OK and nothing else. Do not use any tools.',
    }),
  ]);

  const run = await enqueueRun(admin, { sessionId: session.id, userId, goal: 'smoke test' });
  check('run queued', Boolean(run?.id), run?.id);

  console.log('\n▸ invoking the worker (as Vercel cron would)');
  const res = await fetch(`${BASE_URL}/api/cron/harness-runner`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const payload = await res.json();
  console.log('   worker said:', JSON.stringify(payload));
  check('worker responded 200', res.status === 200, res.status);
  check('worker processed our slice', Array.isArray(payload.processed) && payload.processed.length > 0, payload);

  console.log('\n▸ run reached a terminal state');
  const { data: after } = await admin.from('harness_runs').select('*').eq('id', run!.id).single();
  check('run is completed', after?.status === 'completed', after?.status);
  check('lease released', after?.lease_owner === null, after?.lease_owner);
  check('finished_at stamped', Boolean(after?.finished_at));

  console.log('\n▸ the transcript was written to the log');
  const loaded = await loadSession(admin, userId, session.id);
  const kinds = loaded!.events.map((e) => e.type);
  check('run.status events present', kinds.includes('run.status'), kinds);
  check('assistant reply logged', kinds.includes('assistant.text'), kinds);
  const reply = loaded!.state.items.find((i) => i.kind === 'assistant');
  check('reply text is non-trivial', Boolean(reply && reply.kind === 'assistant' && reply.text.length > 2), reply);
  if (reply && reply.kind === 'assistant') {
    console.log(`   model said: "${reply.text.slice(0, 120)}"`);
    check('model followed the instruction', /PIPELINE_OK/i.test(reply.text), reply.text.slice(0, 80));
  }
  check('no tools were needed', !loaded!.state.items.some((i) => i.kind === 'tool'));

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
