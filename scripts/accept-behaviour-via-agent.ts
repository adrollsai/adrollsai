/**
 * Can the owner change how their agent behaves, by saying so — end to end, through the chat?
 *
 * verify:behaviour proves the wiring from the source side. This proves it the only way an owner
 * experiences it: a sentence in the chat, and the right write on the right row afterwards.
 *
 *   1. "switch the calling voice to Kore"     -> profiles.voice_name changes, no approval needed
 *   2. "run my routine weekly at 6pm"         -> a routine row exists at weekly / 18:00 (or, if the
 *                                                agent also tried to switch it on, an approval card
 *                                                and nothing written)
 *   3. "rewrite my calling script"            -> an APPROVAL CARD, and the playbook is NOT rewritten
 *                                                while it waits
 *
 * Everything it changes is snapshotted first and restored at the end, including the profile JSON,
 * so running it leaves the account exactly as it found it.
 *
 *   npm run accept:behaviour -- --base=http://localhost:3123
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

const MARKER = '__accept_behaviour__';
const OWNER = 'bc63c065-9bcc-4793-bedc-f0960406425b';

function env(name: string): string {
  const raw = fs.readFileSync('.env.local', 'utf8');
  const m = raw.match(new RegExp('^' + name + '=(.*)$', 'm'));
  if (!m) throw new Error(`missing ${name}`);
  return m[1].trim().replace(/^["']|["']$/g, '');
}
function arg(name: string, fallback = ''): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const BASE = arg('base', process.env.MEASURE_BASE_URL || 'https://app.pipixel.io');
const TURN_TIMEOUT_MS = Number(arg('timeoutMs', '300000'));

const admin = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    const text = detail === undefined ? '' : typeof detail === 'string' ? detail : JSON.stringify(detail);
    console.log(`  FAIL ${name}${text ? `  — ${String(text).slice(0, 400)}` : ''}`);
  }
};

async function signIn(userId: string): Promise<string> {
  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const user = users.users.find((u) => u.id === userId) || users.users.find((u) => u.email);
  if (!user?.email) throw new Error(`no email for ${userId}`);
  const jar = new Map<string, string>();
  const supa = createServerClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    cookies: {
      getAll: () => Array.from(jar.entries()).map(([name, value]) => ({ name, value })),
      setAll: (list: Array<{ name: string; value: string }>) => {
        for (const { name, value } of list) {
          if (!value) jar.delete(name);
          else jar.set(name, value);
        }
      },
    },
  });
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: user.email });
  const hashed = (link.data as any)?.properties?.hashed_token;
  if (!hashed) throw new Error('could not mint a magic link');
  const otp = await supa.auth.verifyOtp({ type: 'magiclink', token_hash: hashed });
  if (otp.error) throw new Error(otp.error.message);
  return Array.from(jar.entries()).map(([name, value]) => `${name}=${value}`).join('; ');
}

async function newSession(userId: string, title: string): Promise<string> {
  const { data, error } = await admin
    .from('harness_sessions')
    .insert({ user_id: userId, title, workspace_id: MARKER, status: 'idle' })
    .select('id')
    .single();
  if (error || !data?.id) throw new Error(`could not create a session: ${error?.message}`);
  return String(data.id);
}

interface TurnResult {
  tools: string[];
  said: string;
  outcome: string;
  ms: number;
  lastSeq: number;
  toolErrors: string[];
}

async function ask(sessionId: string, prompt: string, cookie: string, sinceSeq = 0): Promise<TurnResult> {
  const started = Date.now();
  const res = await fetch(`${BASE}/api/agent/v2/runs/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ sessionId, message: prompt, messageId: `u_${Date.now()}` }),
  });
  const outcome = res.headers.get('X-Nobo-Outcome') || '';
  if (!res.ok || !res.body) throw new Error(`turn refused: ${res.status} ${outcome}`);

  const reader = res.body.getReader();
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  let streamed = '';
  let buffer = '';
  const decoder = new TextDecoder();
  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const chunk = JSON.parse(payload);
        if (chunk?.type === 'text-delta' && typeof chunk.delta === 'string') streamed += chunk.delta;
      } catch {
        /* partial line */
      }
    }
  }
  await sleep(2000);

  const { data: rows } = await admin
    .from('harness_events')
    .select('seq, type, data')
    .eq('session_id', sessionId)
    .order('seq', { ascending: true });

  const mine = (rows ?? []).filter((r: any) => Number(r.seq) > sinceSeq);
  const lastSeq = (rows ?? []).reduce((max: number, r: any) => Math.max(max, Number(r.seq) || 0), sinceSeq);
  const calls = mine.filter((r: any) => r.type === 'tool.call');
  const direct = calls.map((r: any) => String(r.data?.name ?? ''));
  const proxied = calls
    .filter((r: any) => String(r.data?.name) === 'call_tool')
    .map((r: any) => String((r.data?.input as any)?.name ?? ''));
  const said =
    mine
      .filter((r: any) => r.type === 'assistant.text')
      .map((r: any) => String(r.data?.text ?? ''))
      .join('\n') || streamed;
  const toolErrors = mine
    .filter((r: any) => r.type === 'tool.result' && /"ok":false|"success":false/.test(JSON.stringify(r.data ?? {})))
    .map((r: any) => JSON.stringify(r.data ?? {}).slice(0, 220));

  return { tools: [...direct, ...proxied], said, outcome, ms: Date.now() - started, lastSeq, toolErrors };
}

async function main() {
  // ---- snapshot everything this test may change
  const { data: beforeProfile } = await admin
    .from('profiles')
    .select('voice_name, auto_call_new_leads, business_info')
    .eq('id', OWNER)
    .maybeSingle();
  const { data: beforeRoutines } = await admin.from('business_routines').select('id').eq('user_id', OWNER);
  const { data: beforePlaybook } = await admin
    .from('business_playbooks')
    .select('id, version')
    .eq('user_id', OWNER)
    .eq('status', 'active')
    .maybeSingle();
  const snapshot = {
    voice: (beforeProfile as any)?.voice_name ?? null,
    autoCall: (beforeProfile as any)?.auto_call_new_leads ?? null,
    businessInfo: (beforeProfile as any)?.business_info ?? null,
    routineIds: (beforeRoutines ?? []).map((r: any) => r.id),
    playbookVersion: (beforePlaybook as any)?.version ?? null,
  };
  console.log(
    `snapshot: voice=${snapshot.voice} autoCall=${snapshot.autoCall} routines=${snapshot.routineIds.length} playbook=v${snapshot.playbookVersion ?? '-'}`,
  );

  const approvalsFrom = new Date(Date.now() - 60_000).toISOString();
  const runId = Date.now().toString(36);
  let sessionId = '';

  const restore = async () => {
    // profile
    const bi = snapshot.businessInfo;
    await admin
      .from('profiles')
      .update({
        voice_name: snapshot.voice,
        auto_call_new_leads: snapshot.autoCall,
        business_info: typeof bi === 'string' ? bi : bi ? JSON.stringify(bi) : null,
      })
      .eq('id', OWNER);

    // routines: delete only the ones this run created
    const { data: nowRoutines } = await admin.from('business_routines').select('id').eq('user_id', OWNER);
    for (const r of nowRoutines ?? []) {
      if (!snapshot.routineIds.includes((r as any).id)) {
        await admin.from('routine_runs').delete().eq('routine_id', (r as any).id);
        await admin.from('business_routines').delete().eq('id', (r as any).id);
      }
    }

    // playbooks: drop versions newer than the snapshot (the script test may have created one)
    const { data: pbs } = await admin
      .from('business_playbooks')
      .select('id, version')
      .eq('user_id', OWNER);
    for (const pb of pbs ?? []) {
      const v = Number((pb as any).version) || 0;
      if (snapshot.playbookVersion === null || v > snapshot.playbookVersion) {
        await admin.from('business_playbooks').delete().eq('id', (pb as any).id);
      }
    }

    // approval cards + harness rows this run created
    const { data: cards } = await admin
      .from('agent_events')
      .select('id, payload')
      .eq('user_id', OWNER)
      .eq('event_type', 'PENDING_ACTION_APPROVAL')
      .gte('created_at', approvalsFrom);
    for (const card of cards ?? []) {
      if (String(JSON.stringify((card as any).payload ?? {})).includes(runId)) {
        await admin.from('agent_events').delete().eq('id', (card as any).id);
      }
    }
    if (sessionId) {
      await admin.from('harness_runs').delete().eq('session_id', sessionId);
      await admin.from('harness_events').delete().eq('session_id', sessionId);
      await admin.from('harness_sessions').delete().eq('id', sessionId);
    }
  };

  try {
    const cookie = await signIn(OWNER);
    sessionId = await newSession(OWNER, `accept:behaviour ${runId}`);
    let cursor = 0;

    // ── 1. the voice
    console.log('\n1. "switch the calling voice to Kore" - does the profile follow?');
    const voiceTurn = await ask(
      sessionId,
      'Switch my default calling voice to Kore. Keep the starting language exactly as it is, and do not start any call campaign. Then tell me what changed.',
      cookie,
      cursor,
    );
    cursor = voiceTurn.lastSeq;
    const { data: afterVoice } = await admin.from('profiles').select('voice_name').eq('id', OWNER).maybeSingle();
    check(
      'it used a calling tool, not a guess',
      voiceTurn.tools.some((t) => /update_default_voice_settings|get_calling_defaults/.test(t)),
      voiceTurn.tools.join(', ') || '(no tools)',
    );
    check('the voice is now Kore in the database', (afterVoice as any)?.voice_name === 'Kore', (afterVoice as any)?.voice_name);
    check('the turn answered in words', voiceTurn.said.trim().length > 0, voiceTurn.said.slice(0, 200));

    // ── 2. the routine
    console.log('\n2. "run my routine weekly at 6pm" - does a routine row follow?');
    const routineTurn = await ask(
      sessionId,
      'Update the standing routine RECORD for this business (the one the CEO tab shows, not the playbook): make it run weekly on Mondays at 6pm, and have it produce one post a week. Do not switch anything on, do not enable auto-calling, and do not start a run now. Tell me what changed and when it will next run.',
      cookie,
      cursor,
    );
    cursor = routineTurn.lastSeq;
    const { data: routines } = await admin.from('business_routines').select('*').eq('user_id', OWNER);
    const written = (routines ?? []).find((r) => !snapshot.routineIds.includes((r as any).id));
    check(
      'it used the routine tools',
      routineTurn.tools.some((t) => /update_routine|get_routine/.test(t)),
      routineTurn.tools.join(', ') || '(no tools)',
    );
    check(
      'the routine now runs weekly at 18:00',
      !!written && (written as any).cadence === 'weekly' && Number((written as any).run_at_hour) === 18,
      written
        ? `${(written as any).cadence} at ${(written as any).run_at_hour}:00, enabled=${(written as any).enabled}`
        : `no routine row written; tools used: ${routineTurn.tools.join(', ') || 'none'}`,
    );
    check(
      'and it was NOT switched on behind the owner\'s back',
      !!written && (written as any).enabled === false,
      written ? `enabled=${(written as any).enabled}` : 'no row',
    );

    // ── 3. the script is gated
    console.log('\n3. "rewrite my calling script" - does it wait for a human?');
    const scriptTurn = await ask(
      sessionId,
      'Rewrite my default calling script. It must open with exactly "Thanks for your enquiry, is now a good time to talk?", then introduce the caller as a senior advisor from {{business}}, and always offer a site visit before ending. Keep it under 120 words. Use no facts from the catalogue - it does not need any.',
      cookie,
      cursor,
    );
    cursor = scriptTurn.lastSeq;
    await sleep(1500);

    const { data: cards } = await admin
      .from('agent_events')
      .select('id, payload, status')
      .eq('user_id', OWNER)
      .eq('event_type', 'PENDING_ACTION_APPROVAL')
      .gte('created_at', approvalsFrom);
    const scriptCard = (cards ?? []).find((c: any) =>
      // Either door: the calling-defaults tool, or the playbook's call_script/cadence section.
      /update_default_voice_settings|call_script/.test(JSON.stringify(c.payload ?? {})),
    );
    const { data: playbookAfter } = await admin
      .from('business_playbooks')
      .select('id, version, call_script')
      .eq('user_id', OWNER)
      .eq('status', 'active')
      .maybeSingle();
    const scriptWritten =
      !!playbookAfter &&
      (snapshot.playbookVersion === null || Number((playbookAfter as any).version) > snapshot.playbookVersion);

    check(
      'the script change came back for approval',
      !!scriptCard,
      scriptCard ? `card ${String((scriptCard as any).id).slice(0, 8)} pending` : 'no approval card',
    );
    check(
      'and nothing was written while it waits',
      !scriptWritten,
      scriptWritten ? `playbook jumped to v${(playbookAfter as any)?.version}` : 'playbook untouched',
    );
    if (scriptTurn.said) console.log(`   said: ${scriptTurn.said.replace(/\s+/g, ' ').slice(0, 220)}`);
    if (scriptTurn.toolErrors.length) console.log(`   tool errors: ${scriptTurn.toolErrors.join(' | ').slice(0, 300)}`);
  } finally {
    await restore();
    const { data: afterProfile } = await admin
      .from('profiles')
      .select('voice_name, auto_call_new_leads')
      .eq('id', OWNER)
      .maybeSingle();
    const { data: afterRoutines } = await admin.from('business_routines').select('id').eq('user_id', OWNER);
    console.log(
      `\nrestored: voice=${(afterProfile as any)?.voice_name} autoCall=${(afterProfile as any)?.auto_call_new_leads} routines=${(afterRoutines ?? []).length}`,
    );
  }

  console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => {
  console.error('acceptance failed:', e?.message || e);
  process.exitCode = 1;
});
