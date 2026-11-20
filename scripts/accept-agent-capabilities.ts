/**
 * Can the agent actually DO the work we have been building for, from a sentence?
 *
 * Everything else in this repo proves a PIECE: the reporting gate proves the queries, verify:audiences
 * proves the matching, verify:broadcast-progress proves the campaign runner. None of that answers the
 * only question an owner has — "I said a thing in chat; did the right work happen?" — because the agent
 * is the part that decides which tool to reach for, and it is the part that has failed before (an
 * earlier run built an audience and then stopped without starting the campaign).
 *
 * So this drives four ordinary requests through the live chat and checks the WIRING end to end:
 *
 *   1. a numbers question        → reporting tools, real figures, no invention
 *   2. "move this lead to X"     → the CRM write lands on the lead, with its history
 *   3. "fix the footer phone"    → page_read_sections + a page_edit_section APPROVAL CARD,
 *                                  and the live page is NOT changed while unapproved
 *   4. "make me an ad image"     → an approval card for generate_ai_image and NO credits spent
 *
 * (2) and (3) use purpose-built probes; (4) is the money case, asserted as "staged but not spent".
 * Everything the run creates is removed afterwards.
 *
 *   npm run accept:agent-capabilities
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

const MARKER = '__accept_agent_caps__';
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
const TURN_TIMEOUT_MS = Number(arg('timeoutMs', '600000'));

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
  results: any[];
  said: string;
  outcome: string;
  ms: number;
  /** Highest event seq seen, so the NEXT turn can look only at its own rows. */
  lastSeq: number;
}

/** One chat turn, drained to completion, plus the tool calls it made and the outputs it got. */
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
  await sleep(2500);

  const { data: rows } = await admin
    .from('harness_events')
    .select('seq, type, data')
    .eq('session_id', sessionId)
    .order('seq', { ascending: true });

  // Only THIS turn's rows. The session accumulates every turn, so without the cursor each turn would
  // inherit the tool calls of the ones before it — and the assertions would pass on earlier work.
  const mine = (rows ?? []).filter((r: any) => Number(r.seq) > sinceSeq);
  const lastSeq = (rows ?? []).reduce((max: number, r: any) => Math.max(max, Number(r.seq) || 0), sinceSeq);
  const calls = mine.filter((r: any) => r.type === 'tool.call');
  const results = mine.filter((r: any) => r.type === 'tool.result');
  // The discovery proxy hides the real tool name inside call_tool's arguments.
  const direct = calls.map((r: any) => String(r.data?.name ?? ''));
  const proxied = calls
    .filter((r: any) => String(r.data?.name) === 'call_tool')
    .map((r: any) => String((r.data?.input as any)?.name ?? ''));
  const said =
    mine
      .filter((r: any) => r.type === 'assistant.text')
      .map((r: any) => String(r.data?.text ?? ''))
      .join('\n') || streamed;

  const errors = mine
    .filter(
      (r: any) =>
        r.type === 'turn.error' ||
        (r.type === 'run.status' && /fail|error|cancel/i.test(JSON.stringify(r.data ?? {})))
    )
    .map((r: any) => r.type + ': ' + String((r.data as any)?.detail ?? (r.data as any)?.status ?? '').slice(0, 160));

  if (errors.length) console.log('   turn reported: ' + errors.join(' | '));

  return { tools: [...direct, ...proxied], results, said, outcome, ms: Date.now() - started, lastSeq };
}

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
  const cookie = await signIn(OWNER);
  const runId = Date.now().toString(36);
  const sessionId = await newSession(OWNER, `accept:agent-caps ${runId}`);
  cleanup.push(async () => {
    await admin.from('harness_runs').delete().eq('session_id', sessionId);
    await admin.from('harness_events').delete().eq('session_id', sessionId);
    await admin.from('harness_sessions').delete().eq('id', sessionId);
  });

  const approvalsFrom = new Date(Date.now() - 60_000).toISOString();
  let cursor = 0;
  cleanup.push(async () => {
    // Only the cards this run staged.
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
  });

  // ── 1. reporting: real numbers, no invention
  console.log('\n1. "what are the numbers?" — does it read the real reports?');
  const reporting = await ask(
    sessionId,
    'Give me today’s numbers: how many leads came in, how many calls were attempted and how many connected. ' +
      'Use the real data on this account, and say the numbers plainly. Do not guess.',
    cookie
    , cursor
  );
  cursor = reporting.lastSeq;
  const reportingTools = reporting.tools.filter((t) =>
    /org_lead_report|org_call_report|ceo_report|lead_conversations|call_queue_status|get_crm_metrics|query_leads/i.test(t)
  );
  check('it reached a reporting tool rather than answering from memory', reportingTools.length > 0, reporting.tools);
  const reportingOutput = reporting.results.map((r) => unwrap((r.data as any)?.output)).find((o) => o && typeof o === 'object');
  check('the report returned real content', Boolean(reportingOutput), JSON.stringify(reportingOutput)?.slice(0, 200));
  check(
    'it quoted at least one number in its answer',
    /\d/.test(reporting.said),
    reporting.said.slice(0, 200).replace(/\s+/g, ' ')
  );
  console.log(`   turn ${Math.round(reporting.ms / 100) / 10}s · tools: ${reportingTools.join(', ') || 'none'}`);

  // ── 2. CRM write on a probe lead
  console.log('\n2. "move this lead to Qualified" — does the write land?');
  const { data: probeLead, error: leadError } = await admin
    .from('leads')
    .insert({
      user_id: OWNER,
      name: `[accept ${runId}] agent cap lead`,
      phone: `9182888${String(Date.now()).slice(-5)}`,
      source: 'agent_probe',
      pipeline_stage: 'New',
      status: 'active',
    })
    .select('id')
    .single();
  if (leadError || !probeLead?.id) throw new Error(`could not create the probe lead: ${leadError?.message}`);
  const leadId = String(probeLead.id);
  cleanup.push(async () => {
    await admin.from('lead_history').delete().eq('lead_id', leadId);
    await admin.from('leads').delete().eq('id', leadId);
  });

  const crm = await ask(
    sessionId,
    `Move the lead "[accept ${runId}] agent cap lead" to the Qualified stage and add the note "interested, call tomorrow". ` +
      'Tell me what changed afterwards.',
    cookie
    , cursor
  );
  cursor = crm.lastSeq;
  const crmTools = crm.tools.filter((t) => /crm_update_lead|crm_query_leads|nobogent_crm|update_lead/i.test(t));
  check('it reached a CRM write tool', crmTools.some((t) => /update/i.test(t)), crm.tools);
  const { data: afterCrm } = await admin.from('leads').select('pipeline_stage, notes').eq('id', leadId).maybeSingle();
  const movedStage = String((afterCrm as any)?.pipeline_stage ?? '');
  const askedWhichStage = /which stage|what stage|stage list|not a stage|cannot find the stage|blocker is the stage/i.test(crm.said);
  check(
    'the lead moved to the requested stage (or the agent asked which stage this pipeline has)',
    movedStage === 'Qualified' || (movedStage !== 'New' && askedWhichStage),
    { movedStage, askedWhichStage, said: crm.said.slice(0, 200) }
  );
  const { data: crmHistory } = await admin.from('lead_history').select('description').eq('lead_id', leadId);
  check(
    'the change is in the lead history',
    (crmHistory ?? []).length > 0,
    (crmHistory ?? []).map((h: any) => h.description)
  );
  console.log(`   turn ${Math.round(crm.ms / 100) / 10}s · tools: ${crmTools.join(', ') || 'none'}`);

  // ── 3. page edit: staged, and the live page untouched
  console.log('\n3. "change the phone number in the footer" — does it stage an approval and leave the page alone?');
  const slug = `accept-agent-${runId}`;
  const pageHtml = `<!DOCTYPE html><html><body>
<section id="hero"><h1>Probe hero</h1><p>Keep me unchanged</p></section>
<footer id="contact"><p>Call 99999 00000</p></footer>
</body></html>`;
  const { data: probePage, error: pageError } = await admin
    .from('landing_pages')
    .insert({ user_id: OWNER, slug, title: `[accept ${runId}] agent cap page`, html_content: pageHtml })
    .select('id')
    .single();
  if (pageError || !probePage?.id) throw new Error(`could not create the probe page: ${pageError?.message}`);
  cleanup.push(async () => {
    await admin.from('landing_pages').delete().eq('id', (probePage as any).id);
  });

  const page = await ask(
    sessionId,
    `On the landing page with slug "${slug}", change the phone number in the footer from "99999 00000" to "91111 22222". ` +
      'Change only that text and leave the rest of the page exactly as it is.',
    cookie
    , cursor
  );
  cursor = page.lastSeq;
  const pageTools = page.tools.filter((t) => /page_read_sections|page_edit_section|create_landing_page|site_publish/i.test(t));
  check('it read the page as sections first', pageTools.includes('page_read_sections'), page.tools);
  check('it reached the section editor', pageTools.includes('page_edit_section'), page.tools);
  const { data: pageAfter } = await admin.from('landing_pages').select('html_content').eq('id', (probePage as any).id).maybeSingle();
  const pageHtmlAfter = String((pageAfter as any)?.html_content ?? '');
  check(
    'the live page is NOT changed while the edit is unapproved',
    /99999 00000/.test(pageHtmlAfter) && !/91111 22222/.test(pageHtmlAfter),
    pageHtmlAfter.replace(/\s+/g, ' ').slice(0, 160)
  );

  const { data: pageCards } = await admin
    .from('agent_events')
    .select('payload')
    .eq('user_id', OWNER)
    .eq('event_type', 'PENDING_ACTION_APPROVAL')
    .gte('created_at', approvalsFrom);
  const pageCard = (pageCards ?? []).find((c: any) => /page_edit_section/.test(JSON.stringify(c.payload ?? {})));
  check('and an approval card was staged for the edit', Boolean(pageCard), (pageCards ?? []).map((c: any) => c.payload?.targetTool));
  console.log(`   turn ${Math.round(page.ms / 100) / 10}s · tools: ${pageTools.join(', ') || 'none'}`);

  // ── 4. a billable creative: staged, not spent
  console.log('\n4. "make me an ad image" — does it stop at the money gate?');
  /**
   * The money case is proved by the GATE's own answer, not by a credits table: a gated tool returns
   * `needs_review` and does not run, so if that is what came back, nothing was spent.
   */
  const gatedRefusals = () =>
    creativeResults
      .map(unwrap)
      .filter((o: any) => o && typeof o === 'object' && o.needs_review === true);
  let creativeResults: any[] = [];

  const creative = await ask(
    sessionId,
    'Make me a square Instagram ad image for our current offer: a headline, the phone number 98765 43210 and a clear ' +
      'call to action. If it needs my approval before spending credits, stage that for me.',
    cookie
    , cursor
  );
  cursor = creative.lastSeq;
  const creativeTools = creative.tools.filter((t) => /generate_ai_image|composeCreative|build_ad_creative_prompt|plan_image/i.test(t));
  check(
    'it planned or staged the creative rather than answering with nothing',
    creativeTools.length > 0,
    creative.tools
  );
  creativeResults = creative.results.map((r: any) => (r.data as any)?.output);
  const refusals = gatedRefusals();
  const billableCall = creative.tools.some((t) => /generate_ai_image|composeCreative/.test(t));
  check(
    'any billable generation came back staged, not executed',
    !billableCall || refusals.length > 0,
    { billableCall, refusals: refusals.length, tools: creative.tools }
  );

  // An image job does several minutes of groundwork (references, layout, the business's own imagery)
  // before it reaches the billable call, and the durable run keeps going after the browser's stream
  // ends — so wait for the card rather than sampling once. This is what a person sees: the card
  // appears when the agent gets there, not when the websocket does.
  let creativeCards: any[] = [];
  for (let attempt = 0; attempt < 90; attempt++) {
    const { data } = await admin
      .from('agent_events')
      .select('payload')
      .eq('user_id', OWNER)
      .eq('event_type', 'PENDING_ACTION_APPROVAL')
      .gte('created_at', approvalsFrom);
    creativeCards = data ?? [];
    if (creativeCards.some((c: any) => /generate_ai_image|composeCreative/.test(JSON.stringify(c.payload ?? {})))) break;
    await sleep(5000);
  }
  const billableCard = (creativeCards ?? []).find((c: any) =>
    /generate_ai_image|composeCreative/.test(JSON.stringify(c.payload ?? {}))
  );
  check(
    'a billable generation was staged for approval',
    Boolean(billableCard),
    (creativeCards ?? []).map((c: any) => c.payload?.targetTool)
  );
  console.log(`   turn ${Math.round(creative.ms / 100) / 10}s · tools: ${creativeTools.join(', ') || 'none'}`);

  console.log('\n--- what the agent said, per request ---');
  console.log(`[numbers] ${reporting.said.slice(0, 300).replace(/\s+/g, ' ')}`);
  console.log(`[crm]     ${crm.said.slice(0, 300).replace(/\s+/g, ' ')}`);
  console.log(`[page]    ${page.said.slice(0, 300).replace(/\s+/g, ' ')}`);
  console.log(`[image]   ${creative.said.slice(0, 300).replace(/\s+/g, ' ')}`);
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
