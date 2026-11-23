/**
 * The approvals screen, on the live app, with a real session.
 *
 * Everything else about flows is provable without a browser: the event queues rows, the clock turns
 * them into approvals, the dispatcher reports the truth. What that leaves unproven is the one step a
 * PERSON takes — and a queue nobody can operate is the same dead end as a queue nobody reads.
 *
 * So this drives the deployed page in headless Chrome as the owner:
 *   1. it renders the step that is waiting (lead, text, buttons) — not an empty state, not a login;
 *   2. approving it calls the API, and the screen reports what the provider actually said;
 *   3. rejecting the other one takes it off the queue and writes `rejected`.
 *
 * The approved step is free-form text with the WhatsApp window shut, so the correct outcome is
 * `blocked` with the 24-hour reason. That is the whole loop proven live WITHOUT messaging anyone —
 * which is the only kind of end-to-end proof that is safe to run unattended.
 *
 *   npm run accept:flow-approvals
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
  if (!m) throw new Error(`missing ${name}`);
  return m[1].trim().replace(/^["']|["']$/g, '');
}

const BASE = arg('base', 'https://app.nobogent.com');
const OWNER = arg('user', 'bc63c065-9bcc-4793-bedc-f0960406425b');
const PORT = Number(arg('port', '9231'));
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));

const admin = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}${detail === undefined ? '' : `  — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail === undefined ? '' : `  — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  }
};

async function signIn(userId) {
  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const user = users.users.find((u) => u.id === userId) || users.users.find((u) => u.email);
  if (!user?.email) throw new Error(`no email for user ${userId}`);
  const jar = new Map();
  const supa = createServerClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
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

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
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
      return;
    }
    for (const fn of listeners.get(msg.method) || []) fn(msg.params);
  };
  const opened = new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('cdp socket failed'));
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
    on(m, fn) {
      const l = listeners.get(m) || [];
      l.push(fn);
      listeners.set(m, l);
    },
    close() {
      try {
        ws.close();
      } catch {}
    },
  };
}

async function waitForHttp(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(250);
  }
  throw new Error(`timed out: ${url}`);
}

const cleanup = [];

async function main() {
  if (!CHROME) throw new Error('no Chrome/Edge found');
  const runId = Date.now().toString(36);

  const { data: lead, error: leadErr } = await admin
    .from('leads')
    .insert({
      user_id: OWNER,
      name: `[accept ${runId}] approvals`,
      phone: '918288835235',
      source: 'flow_probe',
      status: 'active',
      pipeline_stage: 'New',
    })
    .select('id')
    .single();
  if (leadErr || !lead?.id) throw new Error(`could not create the probe lead: ${leadErr?.message}`);
  const leadId = String(lead.id);
  cleanup.push(() => admin.from('leads').delete().eq('id', leadId));

  const seed = async (suffix, body) => {
    const { data, error } = await admin
      .from('agent_pending_deliveries')
      .insert({
        user_id: OWNER,
        lead_id: leadId,
        channel: 'whatsapp',
        to_phone: '918288835235',
        body,
        status: 'pending_approval',
        flow_id: `accept-${runId}`,
        flow_step_index: suffix,
        trigger: 'trigger_whatsapp_inbound',
        run_key: `accept-${runId}-${suffix}`,
      })
      .select('id')
      .single();
    if (error || !data?.id) throw new Error(`could not seed the approval: ${error?.message}`);
    return String(data.id);
  };
  const approveId = await seed(0, `Approvals acceptance ${runId} — this text must appear on the screen.`);
  const rejectId = await seed(1, `Reject me ${runId}`);
  cleanup.push(() => admin.from('agent_pending_deliveries').delete().eq('lead_id', leadId));

  const { cookies } = await signIn(OWNER);

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nobo-approvals-'));
  const chrome = spawn(
    CHROME,
    ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`, '--no-first-run',
     '--disable-gpu', '--window-size=1280,1000', 'about:blank'],
    { stdio: 'ignore' }
  );

  let cdp;
  try {
    await waitForHttp(`http://127.0.0.1:${PORT}/json/version`);
    const list = await waitForHttp(`http://127.0.0.1:${PORT}/json/list`);
    const page = (Array.isArray(list) ? list : []).find((t) => t.type === 'page');
    cdp = connect(page.webSocketDebuggerUrl);
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    for (const c of cookies) {
      await cdp.send('Network.setCookie', {
        name: c.name, value: c.value, domain: new URL(BASE).hostname, path: '/',
        secure: BASE.startsWith('https'), httpOnly: false, sameSite: 'Lax',
      });
    }
    const evaluate = async (expr) => {
      const res = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || 'evaluate failed');
      return res.result?.value;
    };

    await cdp.send('Page.navigate', { url: `${BASE}/dashboard/flows/approvals` });

    const ready = async () =>
      evaluate(`(() => ({
        url: location.pathname,
        text: document.body ? document.body.innerText : '',
        buttons: Array.from(document.querySelectorAll('button')).map(b => (b.innerText || '').trim()),
      }))()`).catch(() => null);

    let state = null;
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await sleep(1000);
      state = await ready();
      if (state && /Accept & send|Approve & send/i.test(state.buttons.join('|'))) break;
    }

    check('a signed-in owner reaches the page (not bounced to login)', state?.url === '/dashboard/flows/approvals', state?.url);
    check('the waiting step is on the screen', /Approvals acceptance/i.test(state?.text ?? ''), (state?.text ?? '').slice(0, 120));
    check('it names the person it would reach', /\[accept .*?\] approvals/i.test(state?.text ?? ''), '');
    check('it offers the decision', /Approve & send/i.test(state?.buttons.join('|')), state?.buttons);
    check('and a refusal', /Reject/i.test(state?.buttons.join('|')), '');

    // Approve the first row: the window is shut, so the honest outcome is "blocked, and here is why".
    await evaluate(`(() => {
      const rows = Array.from(document.querySelectorAll('li'));
      const target = rows.find(r => /Approvals acceptance/i.test(r.innerText));
      const btn = target && Array.from(target.querySelectorAll('button')).find(b => /Approve & send/i.test(b.innerText));
      if (btn) btn.click();
      return !!btn;
    })()`);

    let afterText = '';
    const afterDeadline = Date.now() + 60_000;
    while (Date.now() < afterDeadline) {
      await sleep(900);
      const s = await ready();
      afterText = s?.text ?? '';
      if (/blocked|not sent|24 hours/i.test(afterText)) break;
    }
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync('.work', { recursive: true });
    const shotPath = path.join('.work', 'flow-approvals.png');
    fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
    check('approving reports what actually happened', /not sent|24 hours/i.test(afterText), afterText.match(/.{0,120}(24 hours|not sent).{0,120}/i)?.[0] ?? '');

    const { data: approvedRow } = await admin
      .from('agent_pending_deliveries')
      .select('status, error_message')
      .eq('id', approveId)
      .maybeSingle();
    check('the database agrees: approved then blocked, with the reason on record', approvedRow?.status === 'blocked' && /24 hours/i.test(approvedRow?.error_message ?? ''), approvedRow);

    // Reject the second row. Clicking is retried until the database agrees: the queue is being
    // reloaded right after the approval, so a single click can land on a button that is still
    // disabled — which is a race in the test, not in the screen.
    const clickReject = () =>
      evaluate(`(() => {
        const rows = Array.from(document.querySelectorAll('li'));
        const target = rows.find(r => /Reject me/i.test(r.innerText));
        if (!target) return 'missing';
        const btn = Array.from(target.querySelectorAll('button')).find(b => /Reject/i.test(b.innerText));
        if (!btn) return 'missing';
        if (btn.disabled) return 'disabled';
        btn.click();
        return 'clicked';
      })()`).catch(() => 'error');

    let rejected = null;
    const rejectDeadline = Date.now() + 60_000;
    let lastClick = '';
    while (Date.now() < rejectDeadline) {
      lastClick = await clickReject();
      await sleep(700);
      const { data } = await admin.from('agent_pending_deliveries').select('status').eq('id', rejectId).maybeSingle();
      rejected = data?.status ?? null;
      if (rejected === 'rejected') break;
    }
    check('rejecting writes rejected, and sends nothing', rejected === 'rejected', `${rejected} (last click: ${lastClick})`);
    console.log(`\nscreenshot: ${shotPath}`);
  } finally {
    try {
      cdp?.close();
    } catch {}
    try {
      chrome.kill();
    } catch {}
    for (const undo of cleanup.reverse()) {
      try {
        await undo();
      } catch {}
    }
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  }
}

main().catch((error) => {
  console.error(String(error?.message || error));
  for (const undo of cleanup.reverse()) undo().catch?.(() => {});
  process.exit(1);
});
