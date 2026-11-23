/**
 * How fast does a reply actually reach the browser?
 *
 * Two transports are measurable, and this script measures both against the same
 * deployment:
 *
 *   db   — the PREVIOUS design. A turn is queued, and the runner writes the
 *          growing answer into `harness_events` about four times a second; the
 *          browser paints whatever Realtime has delivered. Time-to-first-token
 *          and paint rate are therefore bounded by Postgres + Realtime.
 *
 *   sse  — the CURRENT design. The model's stream is piped straight to the
 *          caller and nothing is written per token. Time-to-first-token is the
 *          model's, and paint rate is the model's token rate.
 *
 * Run it against the deployment you want to measure, before and after a change:
 *
 *   npm run measure:stream -- --mode=db           # baseline (old transport)
 *   npm run measure:stream -- --mode=sse          # new transport
 *   npm run measure:stream -- --mode=flow          # find_tools -> call_tool -> create_flow
 *
 * It authenticates as an existing user through a magic link minted with the
 * service role, so no password is needed and nothing is created for a human to
 * log into. The session it builds is tagged `__measure__` and deleted afterwards.
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

const MARKER = '__measure__';

function env(name: string): string {
  const raw = fs.readFileSync('.env.local', 'utf8');
  const m = raw.match(new RegExp('^' + name + '=(.*)$', 'm'));
  if (!m) throw new Error(`missing ${name} in .env.local`);
  return m[1].trim().replace(/^["']|["']$/g, '');
}

const SUPABASE_URL = env('NEXT_PUBLIC_SUPABASE_URL');
const ANON_KEY = env('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');

function arg(name: string, fallback = ''): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const MODE = arg('mode', 'sse');
const BASE = arg('base', process.env.MEASURE_BASE_URL || 'https://app.nobogent.com');
const PROMPT = arg('prompt', 'hi');
const TIMEOUT_MS = Number(arg('timeoutMs', '180000'));

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** An authenticated browser-equivalent: the SSR client, with a cookie jar. */
async function signedInClient(): Promise<{ cookieHeader: string; userId: string }> {
  const { data: users, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 50 });
  if (error || !users?.users?.length) throw new Error(`could not list users: ${error?.message}`);
  const user = users.users.find((u) => Boolean(u.email));
  if (!user?.email) throw new Error('no user with an email');

  const jar = new Map<string, string>();
  const supa = createServerClient(SUPABASE_URL, ANON_KEY, {
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
  if (!hashed) throw new Error(`could not mint a magic link: ${link.error?.message}`);

  const otp = await supa.auth.verifyOtp({ type: 'magiclink', token_hash: hashed });
  if (otp.error) throw new Error(`could not verify the magic link: ${otp.error.message}`);

  const cookieHeader = Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  return { cookieHeader, userId: otp.data.user!.id };
}

async function createMeasuredSession(userId: string, title: string): Promise<string> {
  const { data, error } = await admin
    .from('harness_sessions')
    .insert({ user_id: userId, title, workspace_id: MARKER, status: 'idle' })
    .select('id')
    .single();
  if (error || !data) throw new Error(`could not create session: ${error?.message}`);
  return data.id as string;
}

async function cleanup() {
  const { data: sessions } = await admin
    .from('harness_sessions')
    .select('id')
    .eq('workspace_id', MARKER);
  for (const s of sessions || []) {
    await admin.from('harness_runs').delete().eq('session_id', s.id);
    await admin.from('harness_events').delete().eq('session_id', s.id);
    await admin.from('harness_sessions').delete().eq('id', s.id);
  }
}

async function events(sessionId: string) {
  const { data } = await admin
    .from('harness_events')
    .select('seq, type, data')
    .eq('session_id', sessionId)
    .order('seq', { ascending: true });
  return (data || []) as Array<{ seq: number; type: string; data: any }>;
}

/**
 * OLD transport: queue a run, then watch the log the way the browser's Realtime
 * subscription does — poll for new `assistant.text` rows and note when each
 * repaint of the answer became visible.
 */
async function measureDb(cookieHeader: string, userId: string) {
  const sessionId = await createMeasuredSession(userId, 'measure:db');
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/agent/v2/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: cookieHeader },
    body: JSON.stringify({
      sessionId,
      message: PROMPT,
      messageId: `u_${Date.now()}`,
      idempotencyKey: `measure_db_${t0}`,
    }),
  });
  const accepted = res.status;
  await res.json().catch(() => ({}));

  let firstPaintAt: number | null = null;
  let lastPaintAt: number | null = null;
  let paints = 0;
  let lastLength = 0;
  let finalText = '';
  let rewrittenChars = 0;
  let textRows = 0;
  const paintGaps: number[] = [];
  let previousPaintAt: number | null = null;

  while (Date.now() - t0 < TIMEOUT_MS) {
    await sleep(100);
    const rows = await events(sessionId);
    const textRowsNow = rows.filter((r) => r.type === 'assistant.text');
    textRows = textRowsNow.length;
    // The runner upserts ONE row as the answer grows, so every flush rewrites the
    // same text: the row count is the number of DB writes, and the LAST row is
    // the reply. Summing them would count the same words dozens of times.
    const latestText = String(textRowsNow[textRowsNow.length - 1]?.data?.text || '');
    rewrittenChars = textRowsNow.reduce((sum, r) => sum + String(r.data?.text || '').length, 0);
    if (latestText.length !== lastLength) {
      lastLength = latestText.length;
      finalText = latestText;
      const now = Date.now();
      if (firstPaintAt === null) firstPaintAt = now;
      if (previousPaintAt !== null) paintGaps.push(now - previousPaintAt);
      previousPaintAt = now;
      lastPaintAt = now;
      paints++;
    }
    const finished = rows.some(
      (r) => r.type === 'run.status' && ['completed', 'failed', 'cancelled'].includes(String(r.data?.status))
    );
    if (finished && paints > 0) break;
    if (finished && Date.now() - t0 > 20_000) break;
  }

  const chars = finalText.length;
  const tokens = Math.max(1, Math.round(chars / 4));
  const ttftMs = firstPaintAt ? firstPaintAt - t0 : null;
  const spanMs = firstPaintAt && lastPaintAt ? Math.max(1, lastPaintAt - firstPaintAt) : 0;
  const avgGap = paintGaps.length ? paintGaps.reduce((a, b) => a + b, 0) / paintGaps.length : null;

  await cleanup();

  return {
    mode: 'db',
    transport: 'queue -> harness_events -> Realtime -> browser',
    accepted,
    replyChars: chars,
    replyTokens: tokens,
    ttftMs,
    visibleForMs: spanMs,
    elapsedMs: lastPaintAt ? lastPaintAt - t0 : null,
    // How many times the answer on screen could change, and how often.
    paints,
    dbWritesForThisReply: textRows,
    charsWrittenToTheLog: rewrittenChars,
    avgPaintGapMs: avgGap === null ? null : Math.round(avgGap),
    paintsPerSec: spanMs > 0 ? Math.round((paintGaps.length / spanMs) * 1000 * 10) / 10 : null,
    // The number the complaint was about: how fast the words actually arrive.
    tokensPerSec: spanMs > 0 ? Math.round((tokens / spanMs) * 1000 * 10) / 10 : null,
    text: finalText.slice(0, 400),
  };
}

/** Read an SSE body and time each `text-delta` the browser would render. */
async function measureSse(cookieHeader: string, userId: string) {
  const sessionId = await createMeasuredSession(userId, 'measure:sse');
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/agent/v2/runs/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: cookieHeader },
    body: JSON.stringify({ sessionId, message: PROMPT, messageId: `u_${Date.now()}` }),
  });
  const firstByteMs = Date.now() - t0;
  const outcome = res.headers.get('X-Nobo-Outcome') || '';

  if (!res.ok || !res.body || outcome !== 'streaming') {
    const body = await res.text();
    await cleanup();
    throw new Error(`stream refused (${res.status}, outcome=${outcome}): ${body.slice(0, 300)}`);
  }

  let ttftMs: number | null = null;
  let lastDeltaAt: number | null = null;
  let chars = 0;
  let usage: any = null;
  let text = '';
  const gaps: number[] = [];

  const decoder = new TextDecoder();
  let buffer = '';
  const reader = res.body.getReader();
  const deadline = Date.now() + TIMEOUT_MS;

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
      let chunk: any;
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }
      if (chunk?.type === 'text-delta' && typeof chunk.delta === 'string') {
        const now = Date.now();
        if (ttftMs === null) ttftMs = now - t0;
        else if (lastDeltaAt !== null) gaps.push(now - lastDeltaAt);
        lastDeltaAt = now;
        chars += chunk.delta.length;
        text += chunk.delta;
      } else if (chunk?.messageMetadata?.usage) {
        // The SDK attaches metadata to the `finish` (and `start`) chunks, not to
        // a separate message-metadata chunk.
        usage = chunk.messageMetadata.usage;
      } else if (chunk?.type === 'message-metadata' && chunk.messageMetadata?.usage) {
        usage = chunk.messageMetadata.usage;
      }
    }
  }
  try {
    await reader.cancel();
  } catch {
    /* already closed */
  }

  // Give the server a moment to finish the run and write its step events.
  await sleep(1500);
  const rows = await events(sessionId);
  const textRows = rows.filter((r) => r.type === 'assistant.text').length;
  const toolCalls = rows.filter((r) => r.type === 'tool.call').map((r) => String(r.data?.name || ''));

  const spanMs = ttftMs !== null && lastDeltaAt !== null ? lastDeltaAt - t0 - ttftMs : 0;
  const tokens = Number(usage?.outputTokens ?? 0) || Math.max(1, Math.round(chars / 4));
  const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;

  await cleanup();

  return {
    mode: 'sse',
    transport: 'model -> SSE -> browser',
    accepted: res.status,
    outcome,
    chars,
    tokens,
    ttftMs,
    firstByteMs,
    elapsedMs: lastDeltaAt ? lastDeltaAt - t0 : null,
    paints: gaps.length + 1,
    textRows,
    measuredUsage: Boolean(usage?.outputTokens),
    avgPaintGapMs: avgGap === null ? null : Math.round(avgGap),
    paintsPerSec: spanMs > 0 ? Math.round(((gaps.length + 1) / spanMs) * 1000 * 10) / 10 : null,
    tokensPerSec: spanMs > 0 ? Math.round((tokens / spanMs) * 1000 * 10) / 10 : null,
    toolCalls,
    text: text.slice(0, 400),
  };
}

const FLOW_PROMPT =
  'Build me a WhatsApp automation flow called "Measure flow": when someone submits the lead form, ' +
  'send them a WhatsApp message saying "Thanks for reaching out, we will call you shortly." ' +
  'Leave it paused. Do not spend any money and do not message anyone.';

/**
 * The tool surface is deliberately slim: only 12 tool schemas travel with the
 * request and the rest are reached through find_tools -> call_tool. That proxy
 * is what cut the prompt from ~29,435 to ~14,123 tokens, so the flow-building
 * path has to be proved through it, not around it.
 */
async function measureFlow(cookieHeader: string, userId: string) {
  const sessionId = await createMeasuredSession(userId, 'measure:flow');
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/agent/v2/runs/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: cookieHeader },
    body: JSON.stringify({ sessionId, message: FLOW_PROMPT, messageId: `u_${Date.now()}` }),
  });
  const outcome = res.headers.get('X-Nobo-Outcome') || '';

  if (!res.ok || !res.body || outcome !== 'streaming') {
    const body = await res.text();
    await cleanup();
    throw new Error(`stream refused (${res.status}, outcome=${outcome}): ${body.slice(0, 300)}`);
  }

  // Drain the stream so the turn actually runs to completion.
  const reader = res.body.getReader();
  const deadline = Date.now() + TIMEOUT_MS;
  let text = '';
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
        if (chunk?.type === 'text-delta' && typeof chunk.delta === 'string') text += chunk.delta;
      } catch {
        /* partial line */
      }
    }
  }

  await sleep(2500);
  const rows = await events(sessionId);
  const calls = rows.filter((r) => r.type === 'tool.call').map((r) => String(r.data?.name || ''));
  const results = rows.filter((r) => r.type === 'tool.result');
  const createFlowResult = results.find((r) => {
    const out = r.data?.output as any;
    return out && (out.flowId || out.success === true || out.reason);
  });
  const assistantText = rows
    .filter((r) => r.type === 'assistant.text')
    .map((r) => String(r.data?.text || ''))
    .join('\n');

  // The flow the agent built is real. It is created PAUSED (authoring is not
  // activating), but it belongs to a real tenant, so remove the one this
  // measurement created rather than leaving test scaffolding behind.
  // `automations` has no reliable created_at, so the match is on the name the
  // prompt asked for — which nothing else could plausibly be called.
  const createdIds: string[] = [];
  try {
    const { data: automations } = await admin
      .from('automations')
      .select('id, title, is_active')
      .eq('user_id', userId)
      .ilike('title', '%Measure flow%');
    for (const a of automations || []) {
      if (a.is_active === false) createdIds.push(a.id as string);
    }
    if (createdIds.length) await admin.from('automations').delete().in('id', createdIds);
  } catch {
    /* leaving one paused flow behind is not a failure */
  }

  // Surface what the tools actually returned, so "it reached create_flow" is a
  // fact about the call's output rather than an inference from the prose.
  const resultSummaries = results.map((r) => {
    const out: any = (r.data?.output as any) ?? null;
    const inner = out && typeof out === 'object' && 'output' in out ? (out as any).output : out;
    const text = typeof inner === 'string' ? inner : JSON.stringify(inner ?? null);
    return { name: r.data?.name ?? null, text: String(text).slice(0, 240) };
  });

  await cleanup();

  return {
    mode: 'flow',
    elapsedMs: Date.now() - t0,
    toolCalls: calls,
    usedFindTools: calls.includes('find_tools'),
    usedCallTool: calls.includes('call_tool'),
    reachedCreateFlow:
      calls.includes('create_flow') ||
      // call_tool carries the real tool name in its input
      rows
        .filter((r) => r.type === 'tool.call' && r.data?.name === 'call_tool')
        .some((r) => JSON.stringify(r.data?.input || {}).includes('create_flow')),
    createFlowOutput: createFlowResult?.data?.output ?? null,
    toolResults: resultSummaries,
    textRows: rows.filter((r) => r.type === 'assistant.text').length,
    cleanedUpFlows: createdIds.length,
    reply: (assistantText || text).slice(0, 500),
  };
}

(async () => {
  const { cookieHeader, userId } = await signedInClient();
  console.log(`\nMEASURING ${MODE.toUpperCase()} against ${BASE}`);
  console.log(`prompt: ${JSON.stringify(PROMPT)}  user: ${userId.slice(0, 8)}…\n`);

  try {
    await cleanup();
    const result =
      MODE === 'db'
        ? await measureDb(cookieHeader, userId)
        : MODE === 'flow'
          ? await measureFlow(cookieHeader, userId)
          : await measureSse(cookieHeader, userId);
    console.log(JSON.stringify(result, null, 2));
  } catch (err: any) {
    await cleanup().catch(() => {});
    console.error(`\nFAILED: ${err?.message || err}\n`);
    process.exit(1);
  }

  await cleanup().catch(() => {});
  process.exit(0);
})();
