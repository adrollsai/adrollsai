/**
 * What does an installed PWA actually experience?
 *
 * Drives the live URL in headless Chrome over the DevTools protocol and reports
 * the things a phone reports badly: console errors, failed chunk requests, the
 * service worker's state, whether `navigator.serviceWorker.ready` ever resolves,
 * and which caches exist. No new dependencies — Node's WebSocket plus the
 * browser's own debugging port.
 *
 *   npm run diagnose:pwa                 # /dashboard then /dashboard/profile
 *   npm run diagnose:pwa -- --path=/dashboard/agent
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

const BASE = arg('base', 'https://app.pipixel.io');
const PATHS = arg('path', '/dashboard,/dashboard/profile').split(',').filter(Boolean);
const PORT = Number(arg('port', '9224'));
const CHROME =
  arg('chrome') ||
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(
    (p) => fs.existsSync(p)
  );

const SUPABASE_URL = env('NEXT_PUBLIC_SUPABASE_URL');
const ANON_KEY = env('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function signIn() {
  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 50 });
  const user = users.users.find((u) => u.email);
  if (!user?.email) throw new Error('no user with an email');
  const jar = new Map();
  const supa = createServerClient(SUPABASE_URL, ANON_KEY, {
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
  const hashed = link.data?.properties?.hashed_token;
  const otp = await supa.auth.verifyOtp({ type: 'magiclink', token_hash: hashed });
  if (otp.error) throw new Error(otp.error.message);
  return Array.from(jar.entries()).map(([name, value]) => ({ name, value }));
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
  const opened = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('could not open the DevTools socket'));
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
    on(method, fn) {
      const list = listeners.get(method) || [];
      list.push(fn);
      listeners.set(method, list);
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
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${url}`);
}

const PROBE = `
(async () => {
  const out = {};
  out.readyState = document.readyState;
  out.textLength = (document.body && document.body.innerText || '').length;
  out.head = ((document.body && document.body.innerText) || '').slice(0, 160).replace(/\\s+/g, ' ');
  out.looksLoading = /loading|please wait|preparing/i.test(((document.body && document.body.innerText) || '').slice(0, 400));
  out.hydrated = Boolean(document.querySelector('script[src*="_next/static/chunks"]'));
  out.reactRoots = document.querySelectorAll('#__next, main, [data-reactroot]').length;

  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    out.registrations = regs.map((r) => ({
      scope: r.scope,
      script: (r.active || r.installing || r.waiting || {}).scriptURL || null,
      activeState: r.active ? r.active.state : null,
      waiting: Boolean(r.waiting),
      installing: Boolean(r.installing),
    }));
    out.controller = navigator.serviceWorker.controller
      ? navigator.serviceWorker.controller.scriptURL
      : null;
    out.readyResolved = await Promise.race([
      navigator.serviceWorker.ready.then((r) => 'yes:' + (r.active ? r.active.state : 'no-active')),
      new Promise((res) => setTimeout(() => res('timeout-4s'), 4000)),
    ]);
  } else {
    out.registrations = 'serviceWorker unsupported';
  }

  out.pushManager = 'PushManager' in window;
  out.notificationApi = 'Notification' in window;
  out.permission = out.notificationApi ? Notification.permission : null;
  out.standalone = window.matchMedia('(display-mode: standalone)').matches;
  out.caches = 'caches' in window ? await caches.keys() : [];

  // Can this device obtain a push subscription at all? (No gesture, so this only
  // tells us whether the plumbing exists.)
  if ('serviceWorker' in navigator && 'PushManager' in window) {
    try {
      const reg = await navigator.serviceWorker.ready;
      out.canGetSubscription = Boolean(reg.pushManager);
    } catch (e) {
      out.canGetSubscription = 'error: ' + (e && e.message);
    }
  }
  return JSON.stringify(out);
})()
`;

async function main() {
  if (!CHROME) throw new Error('no Chrome or Edge found');
  const cookies = await signIn();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nobo-pwa-'));
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--window-size=430,900',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let cdp;
  const consoleLines = [];
  const exceptions = [];
  const failedRequests = [];
  const requestLog = [];

  try {
    await waitForHttp(`http://127.0.0.1:${PORT}/json/version`);
    const list = await waitForHttp(`http://127.0.0.1:${PORT}/json/list`);
    const page = (Array.isArray(list) ? list : []).find((t) => t.type === 'page');
    cdp = connect(page.webSocketDebuggerUrl);
    await cdp.opened;

    cdp.on('Runtime.consoleAPICalled', (p) => {
      const text = (p.args || [])
        .map((a) => (typeof a.value === 'string' ? a.value : a.description || a.type))
        .join(' ')
        .trim();
      if (text) consoleLines.push(`${p.type}: ${text.slice(0, 300)}`);
    });
    cdp.on('Runtime.exceptionThrown', (p) => {
      const d = p?.exceptionDetails;
      exceptions.push(String(d?.exception?.description || d?.text || '').slice(0, 400));
    });
    cdp.on('Network.loadingFailed', (p) => {
      failedRequests.push({ url: (requestLog.find((r) => r.id === p.requestId) || {}).url, error: p.errorText });
    });
    cdp.on('Network.responseReceived', (p) => {
      if (p.response?.status >= 400) {
        failedRequests.push({ url: p.response.url, status: p.response.status });
      }
    });
    cdp.on('Network.requestWillBeSent', (p) => {
      requestLog.push({ id: p.requestId, url: p.request.url });
    });

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    for (const cookie of cookies) {
      await cdp.send('Network.setCookie', {
        name: cookie.name,
        value: cookie.value,
        domain: new URL(BASE).hostname,
        path: '/',
        secure: BASE.startsWith('https'),
        httpOnly: false,
        sameSite: 'Lax',
      });
    }

    const evaluate = async (expression, awaitPromise = true) => {
      const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
      if (res.exceptionDetails) return { error: res.exceptionDetails.text || 'evaluate failed' };
      return res.result?.value;
    };

    const results = [];
    for (const p of PATHS) {
      consoleLines.length = 0;
      exceptions.length = 0;
      failedRequests.length = 0;
      requestLog.length = 0;

      const target = `${BASE}${p}`;
      const started = Date.now();
      await cdp.send('Page.navigate', { url: target });
      await sleep(6000);

      const probeRaw = await evaluate(PROBE);
      let probe = probeRaw;
      try {
        probe = JSON.parse(probeRaw);
      } catch {
        /* keep the raw error object */
      }

      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
      if (shot) {
        const file = path.join(process.cwd(), '.work', `pwa${p.replace(/\//g, '-')}.png`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      }

      results.push({
        path: p,
        ms: Date.now() - started,
        probe,
        console: consoleLines.slice(0, 14),
        exceptions: exceptions.slice(0, 6),
        failed: failedRequests.slice(0, 12),
      });
    }

    console.log(JSON.stringify({ base: BASE, results }, null, 2));
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

main().catch((err) => {
  console.error('DIAGNOSE FAILED:', err?.message || err);
  process.exit(1);
});
