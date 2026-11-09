/**
 * Live end-to-end verification of the harness store against the real Supabase
 * project, using the service-role key (bypasses RLS — this is an operator test,
 * not a user path).
 *
 * Exercises the REAL migration: the `harness_append_event` SQL function, the
 * unique (session_id, seq) constraint, and the foreign keys. Everything it
 * creates is tagged `workspace_id = '__verify__'` and deleted afterwards,
 * including on failure.
 *
 * Run:  npm run verify:harness:live
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import {
  isAvailable,
  createSession,
  listSessions,
  loadSession,
  appendEvents,
  appendEvent,
  setSessionStatus,
  deleteSession,
  __resetAvailabilityCacheForTests,
} from '../lib/agent/harness/store';
import { stepToEvents } from '../lib/agent/harness/persist';

const MARKER = '__verify__';

function env(name: string): string {
  const raw = fs.readFileSync('.env.local', 'utf8');
  const m = raw.match(new RegExp('^' + name + '=(.*)$', 'm'));
  if (!m) throw new Error(`missing ${name}`);
  return m[1].trim().replace(/^["']|["']$/g, '');
}

const url = env('NEXT_PUBLIC_SUPABASE_URL');
const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

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

/** Remove every artifact this script can create. */
async function cleanup(userId?: string) {
  const { data } = await admin.from('harness_sessions').select('id').eq('workspace_id', MARKER);
  for (const row of data || []) {
    await admin.from('harness_events').delete().eq('session_id', row.id);
    await admin.from('harness_sessions').delete().eq('id', row.id);
  }
  const { data: ws } = await admin.from('harness_workspaces').select('id').eq('name', MARKER);
  for (const row of ws || []) await admin.from('harness_workspaces').delete().eq('id', row.id);
  if (userId) void userId;
}

async function main() {
  // A real auth user is required by the FK on harness_sessions.user_id.
  const { data: profiles, error: pErr } = await admin.from('profiles').select('id').limit(1);
  if (pErr || !profiles?.length) throw new Error(`could not read a profile: ${pErr?.message}`);
  const userId = profiles[0].id as string;
  console.log(`\nusing profile ${userId.slice(0, 8)}… on ${url.match(/https:\/\/([a-z0-9]+)\./)![1]}`);

  await cleanup(userId);

  console.log('\n▸ schema is live');
  __resetAvailabilityCacheForTests();
  check('isAvailable() sees the applied migration', (await isAvailable(admin)) === true);

  console.log('\n▸ create (real INSERT + session.opened via the SQL function)');
  const created = await createSession(admin, userId, { title: 'verify', workspaceId: MARKER });
  check('session row created', Boolean(created?.id), created);
  if (!created) throw new Error('createSession failed — cannot continue');

  const first = await loadSession(admin, userId, created.id);
  check('session.opened event written by harness_append_event', first?.events.length === 1 && first.events[0].type === 'session.opened', first?.events.map((e) => e.type));
  check('seq started at 1', first?.events[0].seq === 1, first?.events[0].seq);

  console.log('\n▸ append a full turn (seq allocation, JSONB round trip)');
  const turn = stepToEvents({
    stepNumber: 0,
    reasoningText: 'Plan the render',
    toolCalls: [{ toolCallId: 'verify_call_1', toolName: 'sandbox_render_hyperframes', input: { title: 'Verify' } }],
    toolResults: [{ toolCallId: 'verify_call_1', output: { success: true, videoUrl: 'https://example.test/v.mp4' } }],
    text: 'Verified end to end.',
  });
  const appended = await appendEvents(admin, created.id, turn);
  check('all step events persisted', appended === turn.length, { appended, expected: turn.length });

  const loaded = await loadSession(admin, userId, created.id);
  const seqs = loaded!.events.map((e) => e.seq);
  check('seq is contiguous and monotonic', seqs.every((s, i) => i === 0 || s === seqs[i - 1] + 1), seqs);
  check('event count matches', loaded!.events.length === 1 + turn.length, loaded!.events.length);
  check(
    'projection reproduces the turn',
    loaded!.state.items.map((i) => i.kind).join(',') === 'reasoning,tool,assistant',
    loaded!.state.items.map((i) => i.kind)
  );
  const toolRow = loaded!.state.items.find((i) => i.kind === 'tool');
  check('tool row done', toolRow?.kind === 'tool' && toolRow.status === 'done', toolRow);
  check(
    'tool output survived JSONB round trip',
    toolRow?.kind === 'tool' && (toolRow.output as any)?.videoUrl === 'https://example.test/v.mp4',
    toolRow?.kind === 'tool' ? toolRow.output : undefined
  );

  console.log('\n▸ metadata + status');
  check('setSessionStatus works', (await setSessionStatus(admin, created.id, 'running')) === true);
  const listed = await listSessions(admin, userId, { workspaceId: MARKER });
  check('session appears in the list', listed.length === 1, listed.length);
  check('status persisted', listed[0]?.status === 'running', listed[0]?.status);

  console.log('\n▸ validation is enforced');
  const bad = await appendEvent(admin, created.id, 'user.message', { id: 'no_text_field' });
  check('appendEvent itself accepts any payload (schema is app-side)', bad === true);
  const afterBad = await loadSession(admin, userId, created.id);
  check(
    'malformed row is dropped when the log is read back',
    !afterBad!.events.some((e) => e.type === 'user.message'),
    afterBad!.events.map((e) => e.type)
  );

  console.log('\n▸ delete cascades');
  check('deleteSession succeeded', (await deleteSession(admin, userId, created.id)) === true);
  const gone = await loadSession(admin, userId, created.id);
  check('session no longer loads', gone === null);
  const { data: orphans } = await admin.from('harness_events').select('id').eq('session_id', created.id);
  check('events cascade-deleted with the session', (orphans || []).length === 0, (orphans || []).length);
}

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
