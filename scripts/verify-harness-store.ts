/**
 * Verification for the harness store — the layer that talks to Postgres.
 *
 * Run:  npm run verify:harness:store
 *
 * The production project does not have the harness tables yet, so this drives
 * the real `store.ts` against an in-memory PostgREST emulator. It proves the
 * parts that a typecheck cannot: seq allocation, the append → load → project
 * round trip, availability detection, and per-user ownership filtering.
 */
import {
  isAvailable,
  createSession,
  listSessions,
  loadSession,
  loadEvents,
  appendEvent,
  appendEvents,
  renameSession,
  deleteSession,
  setSessionStatus,
  createWorkspace,
  listWorkspaces,
  __resetAvailabilityCacheForTests,
} from '../lib/agent/harness/store';
import { stepToEvents } from '../lib/agent/harness/persist';
import { createFakeSupabase } from './fake-supabase';

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail?: unknown) {
  checks++;
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}${detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`);
  }
}

const USER = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

console.log('\n▸ availability detection');
{
  __resetAvailabilityCacheForTests();
  const missing = createFakeSupabase({ missingTables: ['harness_sessions', 'harness_events'] });
  check('missing tables → unavailable', (await isAvailable(missing.client)) === false);

  __resetAvailabilityCacheForTests();
  const present = createFakeSupabase();
  check('present tables → available', (await isAvailable(present.client)) === true);
}

console.log('\n▸ create → append → load → project round trip');
{
  __resetAvailabilityCacheForTests();
  const db = createFakeSupabase();

  const created = await createSession(db.client as any, USER, { title: 'New session', workspaceId: 'ws_a' });
  check('createSession returns a summary', Boolean(created?.id), created);
  check('workspace carried', created?.workspaceId === 'ws_a', created?.workspaceId);

  // Exactly one event so far: session.opened
  const firstEvents = await loadEvents(db.client as any, created!.id);
  check('session.opened written', firstEvents.length === 1 && firstEvents[0].type === 'session.opened', firstEvents.map((e) => e.type));
  check('seq starts at 1', firstEvents[0].seq === 1, firstEvents[0].seq);

  // Append a full turn using the same mapping the chat route uses.
  const turn = stepToEvents({
    stepNumber: 0,
    reasoningText: 'Plan the storyboard',
    toolCalls: [{ toolCallId: 'call_1', toolName: 'sandbox_render_hyperframes', input: { title: 'Diwali' } }],
    toolResults: [{ toolCallId: 'call_1', toolName: 'sandbox_render_hyperframes', output: { success: true, videoUrl: 'https://r2/x.mp4' } }],
    text: 'Here is your video.',
  });
  const appended = await appendEvents(db.client as any, created!.id, turn);
  check('every step event persisted', appended === turn.length, { appended, expected: turn.length });

  const loaded = await loadSession(db.client as any, USER, created!.id);
  check('loadSession finds it for the owner', Boolean(loaded), null);
  check('event count', loaded!.events.length === 1 + turn.length, loaded!.events.length);
  check(
    'projection reproduces the turn',
    loaded!.state.items.map((i) => i.kind).join(',') === 'reasoning,tool,assistant',
    loaded!.state.items.map((i) => i.kind)
  );
  const toolRow = loaded!.state.items.find((i) => i.kind === 'tool');
  check('tool row done', toolRow?.kind === 'tool' && toolRow.status === 'done', toolRow);
  check(
    'tool output survived the round trip',
    toolRow?.kind === 'tool' && (toolRow.output as any)?.videoUrl === 'https://r2/x.mp4'
  );

  console.log('\n  ▸ ownership');
  const stolen = await loadSession(db.client as any, OTHER, created!.id);
  check('another user cannot load the session', stolen === null);
  const otherList = await listSessions(db.client as any, OTHER);
  check('another user sees no sessions', otherList.length === 0, otherList.length);

  console.log('\n  ▸ listing and metadata');
  const mine = await listSessions(db.client as any, USER);
  check('owner sees the session', mine.length === 1, mine.length);
  check('summary carries status', mine[0].status === 'idle', mine[0].status);

  await setSessionStatus(db.client as any, created!.id, 'running');
  const afterStatus = await listSessions(db.client as any, USER);
  check('status updated', afterStatus[0].status === 'running', afterStatus[0].status);

  await renameSession(db.client as any, USER, created!.id, '  Diwali reel  ');
  const afterRename = await listSessions(db.client as any, USER);
  check('rename trims and applies', afterRename[0].title === 'Diwali reel', afterRename[0].title);
  const titleEvents = await loadEvents(db.client as any, created!.id);
  check('rename appended session.titled', titleEvents.some((e) => e.type === 'session.titled'));
  check('seq keeps increasing', titleEvents.every((e, i) => i === 0 || e.seq === titleEvents[i - 1].seq + 1));

  console.log('\n  ▸ delete');
  await deleteSession(db.client as any, USER, created!.id);
  const afterDelete = await listSessions(db.client as any, USER);
  check('session removed for owner', afterDelete.length === 0, afterDelete.length);
}

console.log('\n▸ malformed log rows are dropped, not fatal');
{
  __resetAvailabilityCacheForTests();
  const db = createFakeSupabase();
  const s = await createSession(db.client as any, USER, {});
  // Hand-write bad rows straight into the store, as a corrupt/migrated-then-
  // changed log could contain.
  db.store.harness_events.push(
    { session_id: s!.id, seq: 90, type: 'not.a.real.event', data: {}, created_at: new Date().toISOString() },
    { session_id: s!.id, seq: 91, type: 'user.message', data: { id: 'x' }, created_at: new Date().toISOString() }, // missing text
    { session_id: s!.id, seq: 92, type: 'tool.result', data: { callId: 'ghost' }, created_at: new Date().toISOString() }
  );
  await appendEvent(db.client as any, s!.id, 'assistant.text', { id: 'a1', text: 'still here' });

  const loaded = await loadSession(db.client as any, USER, s!.id);
  check(
    'row with an unknown event type dropped',
    !loaded!.events.some((e) => String(e.type) === 'not.a.real.event'),
    loaded!.events.map((e) => e.type)
  );
  check(
    'user.message missing its text dropped',
    !loaded!.events.some((e) => e.type === 'user.message'),
    loaded!.events.map((e) => e.type)
  );
  check('valid rows survive', loaded!.events.some((e) => e.type === 'assistant.text'));
  check('valid row still projected', loaded!.state.items.some((i) => i.kind === 'assistant'));
  // A schema-valid result for a call that was never logged is kept in the log
  // (it may arrive out of order) but must not fabricate a transcript row.
  const orphanResult = loaded!.state.items.find((i) => i.kind === 'tool');
  check('result for an unknown call does not invent a row', orphanResult === undefined, orphanResult);
}

console.log('\n▸ workspaces');
{
  __resetAvailabilityCacheForTests();
  const db = createFakeSupabase();
  const ws = await createWorkspace(db.client as any, USER, '  Diwali Campaigns  ');
  check('workspace created with trimmed name', ws?.name === 'Diwali Campaigns', ws);
  const list = await listWorkspaces(db.client as any, USER);
  check('workspace listed for owner', list.length === 1, list.length);
  const otherList = await listWorkspaces(db.client as any, OTHER);
  check('workspace hidden from other users', otherList.length === 0, otherList.length);
  const blank = await createWorkspace(db.client as any, USER, '   ');
  check('blank workspace rejected', blank === null);
}

console.log('\n▸ store degrades quietly when tables are missing');
{
  __resetAvailabilityCacheForTests();
  const db = createFakeSupabase({ missingTables: ['harness_sessions', 'harness_events', 'harness_workspaces'] });
  check('listSessions returns [] rather than throwing', (await listSessions(db.client as any, USER)).length === 0);
  check('createSession returns null rather than throwing', (await createSession(db.client as any, USER, {})) === null);
  check('loadSession returns null rather than throwing', (await loadSession(db.client as any, USER, 'x')) === null);
  check('appendEvent reports failure', (await appendEvent(db.client as any, 'x', 'user.message', { id: 'a', text: 'b' })) === false);
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed\n`);
process.exit(failures === 0 ? 0 : 1);
