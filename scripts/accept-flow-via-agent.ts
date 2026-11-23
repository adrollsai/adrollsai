/**
 * Can the AGENT build a working flow — without the builder UI?
 *
 * The flow machinery is proved elsewhere: creation (verify:flow-creation), firing and delivery
 * (probe:flow-delivery), the human decision (accept:flow-approvals). This one tests the thing an
 * owner actually does: describes the flow in chat and expects it to exist, fire, and stop for
 * approval. The builder is not involved, and if the agent cannot produce a *narrow, correct* flow
 * from a sentence, none of the rest matters.
 *
 * The prompt is deliberately plain English: no tool names, no JSON, no field names. What is checked
 * afterwards is what the request asked for — a keyword filter so the flow does not answer every
 * message, the exact wording to send, a handoff to a human, and that it was left PAUSED.
 *
 * Then the flow is fired for real:
 *   1. the agent's flow, read back from `automations`
 *   2. a message that does NOT match the keyword → nothing fires
 *   3. a message that does → the run is queued
 *   4. the clock turns it into ONE approval, and the handoff happens
 *   5. the approvals queue (what the screen reads) shows it
 *
 * Nothing is sent: the approval is never approved here.
 *
 *   npm run accept:flow-via-agent
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

const MARKER = '__accept_flow_agent__';
const OWNER = 'bc63c065-9bcc-4793-bedc-f0960406425b';

function env(name: string): string {
  const raw = fs.readFileSync('.env.local', 'utf8');
  const m = raw.match(new RegExp('^' + name + '=(.*)$', 'm'));
  if (!m) throw new Error(`missing ${name} in .env.local`);
  return m[1].trim().replace(/^["']|["']$/g, '');
}
function arg(name: string, fallback = ''): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const BASE = arg('base', process.env.MEASURE_BASE_URL || 'https://app.nobogent.com');
const TIMEOUT_MS = Number(arg('timeoutMs', '240000'));
const PROMPT =
  'Create an automation flow called "Accept brochure reply". ' +
  'When someone messages us on WhatsApp and their message mentions the brochure, send them exactly: ' +
  '"Here is our brochure. Reply with a time that suits you and we will call you." ' +
  'Then hand it over to a human, with the note "asked for the brochure - call them back". ' +
  'Leave it paused. Do not activate it, do not message anyone and do not spend any money.';

const admin = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${label}${detail === undefined ? '' : `  — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : `  — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  }
};

async function signedIn(): Promise<{ cookieHeader: string; userId: string }> {
  const { data: users, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw new Error(`could not list users: ${error.message}`);
  const user = users.users.find((u) => u.id === OWNER) || users.users.find((u) => u.email);
  if (!user?.email) throw new Error('no user with an email');
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
  if (!hashed) throw new Error(`could not mint a magic link: ${link.error?.message}`);
  const otp = await supa.auth.verifyOtp({ type: 'magiclink', token_hash: hashed });
  if (otp.error) throw new Error(`could not verify the magic link: ${otp.error.message}`);
  return {
    cookieHeader: Array.from(jar.entries()).map(([name, value]) => `${name}=${value}`).join('; '),
    userId: otp.data.user!.id,
  };
}

async function events(sessionId: string) {
  const { data } = await admin
    .from('harness_events')
    .select('seq, type, data')
    .eq('session_id', sessionId)
    .order('seq', { ascending: true });
  return (data || []) as Array<{ seq: number; type: string; data: any }>;
}

/** Unwrap the proxy envelope: call_tool nests the real tool's output under `output.result`. */
function unwrap(output: any): any {
  let value = output;
  for (let depth = 0; depth < 4; depth++) {
    if (!value || typeof value !== 'object') break;
    if ('result' in value && value.result && typeof value.result === 'object') {
      value = value.result;
      continue;
    }
    if ('output' in value && value.output && typeof value.output === 'object' && !('success' in value)) {
      value = value.output;
      continue;
    }
    break;
  }
  return value;
}

const cleanup: Array<() => Promise<unknown>> = [];

async function main() {
  const runId = Date.now().toString(36);
  const { cookieHeader, userId } = await signedIn();
  check('signed in as the owner account', userId === OWNER, userId);

  const { data: session, error: sessionErr } = await admin
    .from('harness_sessions')
    .insert({ user_id: userId, title: `accept:flow-via-agent ${runId}`, workspace_id: MARKER, status: 'idle' })
    .select('id')
    .single();
  if (sessionErr || !session?.id) throw new Error(`could not create the session: ${sessionErr?.message}`);
  const sessionId = String(session.id);
  cleanup.push(async () => {
    await admin.from('harness_runs').delete().eq('session_id', sessionId);
    await admin.from('harness_events').delete().eq('session_id', sessionId);
    await admin.from('harness_sessions').delete().eq('id', sessionId);
  });

  // ── 1. ask the agent, in plain English ───────────────────────────────────
  console.log('\n1. the owner describes the flow in chat (no builder, no tool names)');
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/agent/v2/runs/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: cookieHeader },
    body: JSON.stringify({ sessionId, message: PROMPT, messageId: `u_${Date.now()}` }),
  });
  const outcome = res.headers.get('X-Nobo-Outcome') || '';
  check('the turn streams', res.ok && outcome === 'streaming', { status: res.status, outcome });
  if (!res.ok || !res.body) throw new Error(`stream refused: ${res.status} ${outcome}`);

  const reader = res.body.getReader();
  const deadline = Date.now() + TIMEOUT_MS;
  let streamedText = '';
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
        if (chunk?.type === 'text-delta' && typeof chunk.delta === 'string') streamedText += chunk.delta;
      } catch {
        /* a partial line; the next read completes it */
      }
    }
  }
  const turnMs = Date.now() - t0;
  await sleep(2000);

  const rows = await events(sessionId);
  const calls = rows.filter((r) => r.type === 'tool.call');
  const results = rows.filter((r) => r.type === 'tool.result');
  const said = rows.filter((r) => r.type === 'assistant.text').map((r) => String(r.data?.text ?? '')).join('\n') || streamedText;

  const calledNames = calls.map((r) => String(r.data?.name ?? ''));
  const viaProxy = calls
    .filter((r) => String(r.data?.name) === 'call_tool')
    .map((r) => String((r.data?.input as any)?.name ?? ''));
  const reachedCreate = calledNames.includes('create_flow') || viaProxy.includes('create_flow');
  check('the agent reached create_flow (through the tool proxy if it had to)', reachedCreate, { calledNames, viaProxy });
  console.log(`   turn took ${Math.round(turnMs / 100) / 10}s; tools: ${[...calledNames, ...viaProxy].join(', ') || 'none'}`);

  const createResult = results
    .map((r) => unwrap((r.data as any)?.output))
    .find((out: any) => out && typeof out === 'object' && (out.flowId || out.reason || out.success === false));
  const flowId = String(createResult?.flowId ?? '');
  check('it created a flow and returned its id', !!flowId && createResult?.success === true, createResult && {
    success: createResult.success,
    reason: createResult.reason,
    error: createResult.error,
    nodeCount: createResult.nodeCount,
  });
  if (flowId) cleanup.push(async () => {
    await admin.from('flow_schedules').delete().eq('flow_id', flowId);
    await admin.from('flow_runs').delete().eq('flow_id', flowId);
    await admin.from('agent_pending_deliveries').delete().eq('flow_id', flowId);
    await admin.from('automations').delete().eq('id', flowId);
  });

  check(
    'the agent said the flow is paused, rather than implying it is live',
    /paus/i.test(said),
    said.slice(0, 200).replace(/\s+/g, ' ')
  );

  // ── 2. what it actually stored ───────────────────────────────────────────
  console.log('\n2. the stored flow matches the sentence it was given');
  if (!flowId) throw new Error('no flow was created; nothing further can be verified');
  const { data: flow } = await admin
    .from('automations')
    .select('id, title, description, is_active, user_id')
    .eq('id', flowId)
    .maybeSingle();
  check('the row belongs to the owner', flow?.user_id === OWNER, flow?.user_id);
  check('it is PAUSED, as asked', flow?.is_active === false, { is_active: flow?.is_active });

  let graph: any = null;
  try {
    graph = JSON.parse(String(flow?.description ?? ''));
  } catch {
    /* reported below */
  }
  check('the description is a readable flow graph', Boolean(graph?.nodes?.length), graph ? Object.keys(graph) : null);
  check('the trigger is the inbound-message event', graph?.trigger?.type === 'trigger_whatsapp_inbound', graph?.trigger?.type);

  const keywords: string[] = (graph?.trigger?.keywords ?? []).map((k: any) => String(k).toLowerCase());
  check(
    'it narrowed the flow with a keyword so it does not answer every message',
    keywords.some((k) => k.includes('brochure')),
    graph?.trigger?.keywords
  );

  const nodeTypes: string[] = (graph?.nodes ?? []).map((n: any) => String(n?.type));
  check('it wrote a message node', nodeTypes.includes('whatsappMessageNode'), nodeTypes);
  check('it wrote the handoff as a real, executable node', nodeTypes.includes('action_ai_call_transfer'), nodeTypes);

  const messageText = String(
    (graph?.nodes ?? []).find((n: any) => n?.type === 'whatsappMessageNode')?.data?.message ?? ''
  );
  check(
    'the message is the wording that was asked for',
    /here is our brochure/i.test(messageText) && /time that suits you/i.test(messageText),
    messageText
  );
  const handoffNote = String((graph?.nodes ?? []).find((n: any) => n?.type === 'action_ai_call_transfer')?.data?.note ?? '');
  check('the handoff carries the note it was given', /call them back/i.test(handoffNote), handoffNote);

  const { validateFlow } = await import('../lib/flows/schema');
  check('the flow it wrote passes the publish gate', validateFlow({ nodes: graph?.nodes ?? [], edges: [] }).ok === true, validateFlow({ nodes: graph?.nodes ?? [], edges: [] }).issues);

  // ── 3. fire it, for real ─────────────────────────────────────────────────
  console.log('\n3. the flow the agent wrote actually fires — and only when it should');
  const { data: lead } = await admin
    .from('leads')
    .insert({ user_id: OWNER, name: `[accept ${runId}] agent flow`, phone: '918288835235', source: 'flow_probe', status: 'active', pipeline_stage: 'New' })
    .select('id')
    .single();
  if (!lead?.id) throw new Error('could not create the probe lead');
  const leadId = String(lead.id);
  cleanup.push(async () => {
    await admin.from('agent_pending_deliveries').delete().eq('lead_id', leadId);
    await admin.from('flow_schedules').delete().eq('lead_id', leadId);
    await admin.from('flow_runs').delete().eq('lead_id', leadId);
    await admin.from('lead_history').delete().eq('lead_id', leadId);
    await admin.from('leads').delete().eq('id', leadId);
  });

  // The owner's decision, simulated: an agent-created flow starts paused.
  await admin.from('automations').update({ is_active: true }).eq('id', flowId);

  const { fireFlowTrigger } = await import('../lib/flows/ingress');
  const { runDueSteps } = await import('../lib/flows/scheduling');
  const { scheduledStore } = await import('../lib/flows/store');
  const { queueDueStep } = await import('../lib/flows/queue-step');
  const { listDeliveries } = await import('../lib/flows/delivery');

  const irrelevant = await fireFlowTrigger(admin, {
    userId: OWNER,
    trigger: 'trigger_whatsapp_inbound',
    leadId,
    text: 'hello, just checking the office timings',
    runKey: `irrelevant:${runId}`,
  });
  check(
    'an unrelated message does NOT start it',
    irrelevant.started.every((s) => s.flowId !== flowId),
    irrelevant.started.map((s) => s.title)
  );

  const matching = await fireFlowTrigger(admin, {
    userId: OWNER,
    trigger: 'trigger_whatsapp_inbound',
    leadId,
    text: 'hi, can you send the brochure for the 3BHK?',
    runKey: `matching:${runId}`,
  });
  const started = matching.started.find((s) => s.flowId === flowId);
  check('a message about the brochure starts it', !!started, matching.skipped.slice(0, 3));
  check('it queued both steps', started?.queued === 2, started?.queued);

  // ── 4. the clock, and the human gate ─────────────────────────────────────
  console.log('\n4. the run becomes ONE approval, and the handoff happens');
  const clock = new Date();
  clock.setDate(clock.getDate() + 1);
  clock.setHours(10, 0, 0, 0);
  const report = await runDueSteps(scheduledStore(admin, OWNER), clock, {
    quietHours: { startHour: 0, endHour: 0 },
    limit: 50,
    execute: async (step) => {
      if (step.leadId !== leadId) return;
      await queueDueStep(admin, { userId: OWNER, step });
    },
  });
  check('the due steps ran', report.executed.length >= 1, report.skipped.slice(0, 3));

  const pending = (await listDeliveries(admin, OWNER, { status: ['pending_approval'], limit: 200 })).filter((d) => d.leadId === leadId);
  check('exactly one step is waiting for a human', pending.length === 1, pending.map((d) => d.status));
  check('it is the message the agent wrote', /here is our brochure/i.test(pending[0]?.body ?? ''), pending[0]?.body);
  check('it would go to the real number', pending[0]?.toPhone === '918288835235', pending[0]?.toPhone);

  const { data: history } = await admin.from('lead_history').select('description').eq('lead_id', leadId);
  check(
    'the handoff was applied to the CRM',
    (history ?? []).some((h: any) => /call them back/i.test(String(h.description))),
    (history ?? []).map((h: any) => h.description)
  );
  const { data: stillPending } = await admin.from('agent_pending_deliveries').select('status').eq('lead_id', leadId);
  check(
    'nothing was sent: the step is still pending, not delivered',
    (stillPending ?? []).every((r: any) => r.status === 'pending_approval'),
    (stillPending ?? []).map((r: any) => r.status)
  );

  console.log('\n--- what the owner sees in chat ---');
  console.log(said.trim().split('\n').slice(0, 8).join('\n'));
}

async function run() {
  try {
    await main();
  } catch (error: any) {
    fail++;
    console.log(`  FAIL acceptance crashed: ${String(error?.message || error)}`);
  } finally {
    for (const undo of cleanup.reverse()) {
      try {
        await undo();
      } catch {}
    }
    // Any session this script created is scaffolding, not a conversation to keep.
    const { data: sessions } = await admin.from('harness_sessions').select('id').eq('workspace_id', MARKER);
    for (const s of sessions ?? []) {
      await admin.from('harness_runs').delete().eq('session_id', (s as any).id);
      await admin.from('harness_events').delete().eq('session_id', (s as any).id);
      await admin.from('harness_sessions').delete().eq('id', (s as any).id);
    }
    console.log(`\n${'='.repeat(64)}`);
    console.log(`${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  }
}

void run();
