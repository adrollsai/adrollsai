/**
 * Does an approval card actually reach the owner's screen?
 *
 * `verify:tool-artifacts` proves the card survives the discovery proxy in the
 * data. That is necessary and not sufficient: the bug being fixed was in the
 * renderer, so this drives a real browser and looks for the card.
 *
 * It is deterministic and spends no model tokens. Instead of asking the agent to
 * do something, it seeds a session with the EXACT event shape production
 * produced when a gated tool was refused through the proxy:
 *
 *   tool.call    call_tool { name: "nobogent_whatsapp_send_template", … }
 *   tool.result  { ok: true, tool: "nobogent_whatsapp_send_template",
 *                  result: { success: false, needs_review: true, requiresApproval: true,
 *                            actionId: "act_…", artifact: { type: "action_confirmation", … } } }
 *
 * ...then opens that conversation and asserts the card is on screen with its
 * Approve button, and that the row is labelled with the real tool rather than
 * "call tool".
 *
 *   npm run verify:approval-card-ui
 *   npm run verify:approval-card-ui -- --base=https://app.nobogent.com
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

function arg(name, fallback = '') {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
function env(name) {
  const raw = fs.readFileSync('.env.local', 'utf8');
  const m = raw.match(new RegExp('^' + name + '=(.*)$', 'm'));
  if (!m) throw new Error(`missing ${name} in .env.local`);
  return m[1].trim().replace(/^["']|["']$/g, '');
}

const BASE = arg('base', 'https://app.nobogent.com');
const PORT = Number(arg('port', '9224'));
const CHROME =
  arg('chrome') ||
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(
    (p) => fs.existsSync(p)
  );

const URL_ = env('NEXT_PUBLIC_SUPABASE_URL');
const ANON = env('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY');
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  const text = detail === undefined ? '' : `  — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  if (ok) {
    pass++;
    console.log(`  ok   ${name}${text}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${text}`);
  }
}

async function signIn() {
  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 50 });
  const user = users.users.find((u) => u.email);
  if (!user?.email) throw new Error('no user with an email');
  const jar = new Map();
  const supa = createServerClient(URL_, ANON, {
    cookies: {
      getAll: () => Array.from(jar.entries()).map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const { name, value } of list) {
          if (!value) jar.delete(name);
          else jar.set(name, value);
        }
      },
    },
  });
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: user.email });
  const otp = await supa.auth.verifyOtp({ type: 'magiclink', token_hash: link.data.properties.hashed_token });
  if (otp.error) throw new Error(otp.error.message);
  return { userId: otp.data.user.id, cookies: Array.from(jar.entries()).map(([name, value]) => ({ name, value })) };
}

/** Minimal DevTools client. */
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };
  const opened = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('devtools socket failed'));
  });
  return {
    opened,
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      try {
        ws.close();
      } catch {}
    },
  };
}

async function waitJson(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {}
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${url}`);
}

/** Seed a session whose log ends in a refused gated call, exactly as production writes it. */
async function seedSession(userId, actionId) {
  const title = `Approval card check ${Date.now().toString(36)}`;
  const { data: session, error } = await admin
    .from('harness_sessions')
    .insert({ user_id: userId, title, workspace_id: 'default', status: 'idle' })
    .select('id')
    .single();
  if (error || !session) throw new Error(`could not create session: ${error?.message}`);

  const pendingInsert = await admin.from('agent_events').insert({
    user_id: userId,
    event_type: 'PENDING_ACTION_APPROVAL',
    status: 'pending',
    scheduled_for: new Date().toISOString(),
    payload: {
      actionId,
      actionType: 'whatsapp_broadcast',
      title: 'Approve: nobogent_whatsapp_send_template',
      description: 'This step cannot run until it is approved, because a real customer receives it.',
      targetTool: 'nobogent_whatsapp_send_template',
      actionPayload: { phone: '+918288835235', templateName: 'auto_drip_followup_24h', variables: ['Rahul'] },
      resumePrompt: '',
    },
  });
  if (pendingInsert.error) throw new Error(`could not stage the approval row: ${pendingInsert.error.message}`);

  const events = [
    { type: 'session.opened', data: { title, workspaceId: 'default' } },
    { type: 'user.message', data: { id: `u_${actionId}`, text: 'whatsapp my test number the 24h follow-up template' } },
    { type: 'run.status', data: { status: 'running', detail: 'seeded for the approval-card check' } },
    {
      type: 'tool.call',
      data: {
        callId: `c_${actionId}`,
        name: 'call_tool',
        input: {
          name: 'nobogent_whatsapp_send_template',
          arguments: { phone: '+918288835235', templateName: 'auto_drip_followup_24h', variables: ['Rahul'] },
        },
      },
    },
    {
      type: 'tool.result',
      data: {
        callId: `c_${actionId}`,
        name: 'call_tool',
        // The production shape: the real result is one level down, inside `result`.
        output: {
          tool: 'nobogent_whatsapp_send_template',
          ok: true,
          result: {
            success: false,
            needs_review: true,
            requiresApproval: true,
            actionId,
            actionType: 'whatsapp_broadcast',
            artifact: {
              type: 'action_confirmation',
              actionId,
              actionType: 'whatsapp_broadcast',
              title: 'Approve: nobogent_whatsapp_send_template',
              description: 'This step cannot run until it is approved, because a real customer receives it.',
              status: 'pending',
              payload: { phone: '+918288835235', templateName: 'auto_drip_followup_24h', variables: ['Rahul'] },
            },
            message: `"nobogent_whatsapp_send_template" did not run: a real customer receives it.`,
          },
        },
      },
    },
    { type: 'assistant.text', data: { id: `s_${actionId}_t`, text: 'Staged the WhatsApp send. One tap on the card below runs it.' } },
    { type: 'run.status', data: { status: 'completed' } },
  ];

  for (const event of events) {
    const { error: appendError } = await admin.rpc('harness_append_event', {
      p_session_id: session.id,
      p_type: event.type,
      p_data: event.data,
    });
    if (appendError) throw new Error(`could not append ${event.type}: ${appendError.message}`);
  }

  await admin.from('harness_sessions').update({ updated_at: new Date().toISOString() }).eq('id', session.id);
  return { sessionId: session.id, title };
}

const SNAPSHOT_JS = `
(() => {
  const text = (el) => (el && el.innerText ? el.innerText.trim() : '');
  const body = document.body.innerText || '';
  const cardButtons = Array.from(document.querySelectorAll('button'))
    .map((b) => text(b))
    .filter((t) => /approve & execute|cancel/i.test(t));
  const callToolRows = Array.from(document.querySelectorAll('span'))
    .map((s) => text(s))
    .filter((t) => /^call tool$/i.test(t));
  const danger = Array.from(document.querySelectorAll('.dsh-danger')).map(text).filter(Boolean);
  const toasts = Array.from(document.querySelectorAll('[data-sonner-toast]')).map(text).filter(Boolean);
  return JSON.stringify({
    hasCardTitle: body.includes('Approve: nobogent_whatsapp_send_template'),
    hasCardReason: body.includes('a real customer receives it'),
    hasTemplateName: body.includes('auto_drip_followup_24h'),
    hasPhone: body.includes('82888 35235') || body.includes('8288835235') || body.includes('+918288835235'),
    cardButtons,
    callToolRows: callToolRows.length,
    danger, toasts,
    transcriptLen: body.length,
  });
})()
`;

async function main() {
  if (!CHROME) throw new Error('no Chrome or Edge found');
  const { userId, cookies } = await signIn();
  const actionId = 'act_ui' + Date.now().toString(36);
  const seeded = await seedSession(userId, actionId);
  console.log(`\nAPPROVAL CARD UI  ${BASE}  (session ${seeded.sessionId.slice(0, 8)}, action ${actionId})`);

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nobo-approval-'));
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      '--window-size=1440,1800',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let cdp;
  try {
    await waitJson(`http://127.0.0.1:${PORT}/json/version`);
    const list = await waitJson(`http://127.0.0.1:${PORT}/json/list`);
    const page = (Array.isArray(list) ? list : list.targets || []).find((t) => t.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('no page target');

    cdp = connect(page.webSocketDebuggerUrl);
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    for (const cookie of cookies) {
      await cdp
        .send('Network.setCookie', {
          name: cookie.name,
          value: cookie.value,
          domain: new URL(BASE).hostname,
          path: '/',
          secure: BASE.startsWith('https'),
          httpOnly: false,
          sameSite: 'Lax',
        })
        .catch(() => {});
    }

    await cdp.send('Page.navigate', { url: `${BASE}/dashboard/agent` });

    const evaluate = async (expression) => {
      const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || 'evaluate failed');
      return res.result?.value;
    };

    // Wait for the composer, then make sure the seeded conversation is the one on
    // screen: click its tile in the sidebar if the app adopted something else.
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const ready = await evaluate(`Boolean(document.querySelector('textarea[aria-label="Message the agent"]'))`).catch(() => false);
      if (ready) break;
      await sleep(300);
    }
    await sleep(2500);

    const clicked = await evaluate(`
      (() => {
        const wanted = ${JSON.stringify(seeded.title)};
        const nodes = Array.from(document.querySelectorAll('button, div, span, a'));
        const hit = nodes.find((n) => (n.innerText || '').trim() === wanted);
        if (!hit) return 'not-found';
        const clickable = hit.closest('button') || hit;
        clickable.click();
        return 'clicked';
      })()
    `);
    console.log(`   sidebar: ${clicked}`);
    await sleep(3500);

    const snap = JSON.parse(await evaluate(SNAPSHOT_JS));
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    const shotPath = path.join(process.cwd(), '.work', 'approval-card.png');
    fs.mkdirSync(path.dirname(shotPath), { recursive: true });
    fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));

    console.log('\n▸ what the owner sees');
    check('the approval card is on screen', snap.hasCardTitle === true, snap.hasCardTitle ? '' : 'card title not found');
    check('…explaining why it is held', snap.hasCardReason === true);
    check('…naming the exact template being approved', snap.hasTemplateName === true);
    check('…showing the number it will go to', snap.hasPhone === true);
    check(
      '…with an Approve button and a Cancel button',
      snap.cardButtons.some((t) => /approve/i.test(t)) && snap.cardButtons.some((t) => /cancel/i.test(t)),
      snap.cardButtons
    );
    check('the row is not left labelled a bare "call tool"', snap.callToolRows === 0, `"call tool" rows: ${snap.callToolRows}`);
    check('no red error text on the screen', snap.danger.length === 0, snap.danger);
    check('no error toasts', snap.toasts.length === 0, snap.toasts);
    console.log(`   screenshot: ${shotPath}`);

    await admin.from('harness_events').delete().eq('session_id', seeded.sessionId);
    await admin.from('harness_sessions').delete().eq('id', seeded.sessionId);
    await admin.from('agent_events').delete().eq('payload->>actionId', actionId);

    console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass}/${pass + fail} checks passed\n`);
    process.exitCode = fail === 0 ? 0 : 1;
  } finally {
    try {
      cdp?.close();
    } catch {}
    try {
      chrome.kill();
    } catch {}
    await sleep(400);
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {}
  }
}

main().catch(async (err) => {
  console.error(`\nFAILED: ${err?.message || err}\n`);
  process.exit(1);
});
