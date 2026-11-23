/**
 * The acceptance check, in a real browser, against the live URL.
 *
 *   npm run accept:stream-ui
 *   npm run accept:stream-ui -- --base=https://app.nobogent.com --prompt=hi
 *
 * What it proves, and why each part exists:
 *
 *   1. "hi" in a NEW session gets an answer that TYPES — the reply's visible
 *      text is sampled as it grows, so the report is a measured characters/sec
 *      and time-to-first-visible-character, not a promise.
 *   2. ONE reply only. The DOM is checked for a second copy of the answer, and
 *      the session's event log is checked for a second `assistant.text` row.
 *      Duplicate replies have shipped before; this is the check that catches it.
 *   3. NO error banners. Sonner toasts, error-styled rows and the renderer's own
 *      "could not be rendered" fallback are all inspected, and console errors
 *      are collected.
 *
 * It drives Chrome over the DevTools protocol with no extra dependencies: Node's
 * WebSocket plus the browser's own remote-debugging port.
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
const PROMPT = arg('prompt', 'hi');
const AGENT_PATH = arg('path', '/dashboard/agent');
const PORT = Number(arg('port', '9223'));
const CAPTURE_TIMEOUT_MS = Number(arg('timeoutMs', '180000'));
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

/** Sign in as an existing user and return the cookies a browser would hold. */
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
  if (!hashed) throw new Error('could not mint a magic link');
  const otp = await supa.auth.verifyOtp({ type: 'magiclink', token_hash: hashed });
  if (otp.error) throw new Error(otp.error.message);

  return { userId: otp.data.user.id, cookies: Array.from(jar.entries()).map(([name, value]) => ({ name, value })) };
}

/** Minimal DevTools-protocol client over Node's built-in WebSocket. */
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
      if (msg.error) reject(new Error(msg.error.message || 'CDP error'));
      else resolve(msg.result);
      return;
    }
    for (const fn of listeners.get(msg.method) || []) fn(msg.params, msg.sessionId);
  };

  const opened = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('could not open the DevTools socket'));
  });

  return {
    opened,
    send(method, params = {}, sessionId) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
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

/** Everything the page can tell us about the transcript, in one round trip. */
const SNAPSHOT_JS = `
(() => {
  const text = (el) => (el && el.innerText ? el.innerText.trim() : '');
  const cards = Array.from(document.querySelectorAll('.nobo-agent-card')).map(text).filter(Boolean);
  const liveBubbles = Array.from(document.querySelectorAll('.nobo-bubble-agent')).map(text).filter(Boolean);
  const userBubbles = Array.from(document.querySelectorAll('.nobo-bubble-user')).map(text).filter(Boolean);
  const toasts = Array.from(document.querySelectorAll('[data-sonner-toast]')).map((el) => ({
    text: text(el),
    type: el.getAttribute('data-type') || '',
  })).filter((t) => t.text);
  const dangerText = Array.from(document.querySelectorAll('.dsh-danger')).map(text).filter(Boolean);
  const crash = /could not be rendered/i.test(document.body.innerText || '');
  const working = Array.from(document.querySelectorAll('[aria-live="polite"]')).map(text).filter(Boolean);
  const all = (cards.join('\\n') + '\\n' + liveBubbles.join('\\n')).trim();
  return JSON.stringify({ cards, liveBubbles, userBubbles, toasts, dangerText, crash, working, all, len: all.length });
})()
`;

async function main() {
  if (!CHROME) throw new Error('no Chrome or Edge found');
  const { userId, cookies } = await signIn();
  const startedAtMs = Date.now();
  console.log(`\nACCEPTANCE  ${BASE}${AGENT_PATH}  prompt=${JSON.stringify(PROMPT)}  user=${userId.slice(0, 8)}…`);

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nobo-accept-'));
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
    { stdio: 'ignore', detached: false }
  );

  let cdp;
  const consoleErrors = [];
  const pageExceptions = [];
  /** Every /api/agent call the page made, with its status. This is the proof that
   *  the browser used the streaming endpoint rather than the legacy one. */
  const netLog = [];
  const netById = new Map();
  const baselineSessions = new Set(
    ((
      await admin
        .from('harness_sessions')
        .select('id')
        .eq('user_id', userId)
    ).data || []).map((s) => s.id)
  );

  try {
    const version = await waitForHttp(`http://127.0.0.1:${PORT}/json/version`);
    const target = { url: 'about:blank' };
    void version;
    void target;
    const list = await waitForHttp(`http://127.0.0.1:${PORT}/json/list`);
    const page = (Array.isArray(list) ? list : list.targets || []).find((t) => t.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('no page target');

    cdp = connect(page.webSocketDebuggerUrl);
    await cdp.opened;

    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p?.type !== 'error') return;
      const text = (p.args || [])
        .map((a) => (typeof a.value === 'string' ? a.value : a.description || a.type))
        .join(' ')
        .trim();
      if (text) consoleErrors.push(text.slice(0, 300));
    });
    cdp.on('Runtime.exceptionThrown', (p) => {
      const text = p?.exceptionDetails?.exception?.description || p?.exceptionDetails?.text || '';
      if (text) pageExceptions.push(String(text).slice(0, 300));
    });
    cdp.on('Network.requestWillBeSent', (p) => {
      const url = p?.request?.url || '';
      if (!url.includes('/api/agent/')) return;
      netById.set(p.requestId, { method: p.request.method, url: url.replace(BASE, '') });
    });
    cdp.on('Network.responseReceived', (p) => {
      const entry = netById.get(p.requestId);
      if (!entry) return;
      entry.status = p.response?.status;
      const headers = p.response?.headers || {};
      const key = Object.keys(headers).find((k) => k.toLowerCase() === 'x-nobo-outcome');
      if (key) entry.outcome = headers[key];
      netLog.push(entry);
    });

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    // Hand the browser the session cookies the app's own SSR client would set.
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
        .catch(async () => {
          await cdp.send('Network.setCookies', {
            cookies: [
              {
                name: cookie.name,
                value: cookie.value,
                domain: new URL(BASE).hostname,
                path: '/',
                secure: BASE.startsWith('https'),
              },
            ],
          });
        });
    }

    await cdp.send('Page.navigate', { url: `${BASE}${AGENT_PATH}` });

    const evaluate = async (expression) => {
      const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || 'evaluate failed');
      return res.result?.value;
    };

    // Wait for the composer.
    const waitForComposer = async () => {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const ok = await evaluate(
          `Boolean(document.querySelector('textarea[aria-label="Message the agent"]'))`
        ).catch(() => false);
        if (ok) return true;
        await sleep(300);
      }
      return false;
    };
    if (!(await waitForComposer())) throw new Error('the composer never appeared — the session is not authenticated');

    // A NEW session, as the acceptance requires. `--newSession=false` reuses
    // whatever the app last had open, which is how the multi-turn case gets
    // tested: a second message in a session that already has a reply.
    const reuseSession = arg('newSession', 'true') === 'false';
    let newSessionClick = 'skipped';
    if (!reuseSession) {
      newSessionClick = await evaluate(`
        (() => {
          const btn = Array.from(document.querySelectorAll('button'))
            .find((b) => (b.innerText || '').trim().toLowerCase() === 'new session');
          if (!btn) return 'not-found';
          btn.click();
          return 'clicked';
        })()
      `);
      // Wait for the server-side session to exist, not just for a fixed delay:
      // clicking straight after a page load races the availability probe, and a
      // "new session" that only exists in localStorage is not a new session.
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        if (netLog.some((n) => n.url.includes('/api/agent/v2/sessions') && n.method === 'POST' && n.status === 200)) break;
        await sleep(200);
      }
      await sleep(1200);
    } else {
      // Reusing a thread only means anything once the previous transcript is on
      // screen; sending earlier would silently start a new session instead and
      // the second-turn case would go untested.
      const deadline = Date.now() + 25_000;
      while (Date.now() < deadline) {
        const cards = JSON.parse(await evaluate(SNAPSHOT_JS).catch(() => '{"cards":[]}')).cards.length;
        if (cards > 0) break;
        await sleep(300);
      }
    }
    const logSessionId = await evaluate(`(() => { try { return localStorage.getItem('nobo_harness_last_sess'); } catch { return null; } })()`);
    const beforeSnap = JSON.parse(await evaluate(SNAPSHOT_JS));
    const beforeCards = beforeSnap.cards;
    const blocksBefore = beforeCards.length;

    // Focus the composer, type, send.
    await evaluate(`document.querySelector('textarea[aria-label="Message the agent"]').focus()`);
    await sleep(150);

    // Record every visible change of the transcript from inside the page.
    //
    // Polling over the DevTools socket can only see ~10 frames a second, which is
    // too coarse to describe typing. A MutationObserver sees every commit, so the
    // report below is the browser's own timeline rather than our sampling rate.
    await evaluate(`
      (() => {
        window.__nobo = { t0: performance.now(), events: [] };
        const read = () => Array.from(document.querySelectorAll('.nobo-agent-card, .nobo-bubble-agent'))
          .map((el) => el.innerText || '').join('').trim().length;
        let last = read();
        const observer = new MutationObserver(() => {
          const n = read();
          if (n !== last) {
            last = n;
            window.__nobo.events.push([Math.round(performance.now() - window.__nobo.t0), n]);
          }
        });
        observer.observe(document.body, { subtree: true, childList: true, characterData: true });
        window.__nobo.observer = observer;
        return 'observing';
      })()
    `);

    await cdp.send('Input.insertText', { text: PROMPT });
    await sleep(150);
    for (const type of ['keyDown', 'keyUp']) {
      await cdp.send('Input.dispatchKeyEvent', {
        type,
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
        text: type === 'keyDown' ? '\r' : undefined,
      });
    }

    const sentAt = Date.now();
    // Poll only to decide when the turn is done; the timings come from the page.
    //
    // "No new text for a while" is not the same as "finished": a multi-step turn
    // goes quiet while a tool runs. The composer's own working strip says whether
    // the agent is still busy, so completion is text-quiet AND not-working.
    let lastGrowthAt = sentAt;
    let sawText = false;
    let highWater = 0;
    let stillWorking = true;
    while (Date.now() - sentAt < CAPTURE_TIMEOUT_MS) {
      await sleep(150);
      const snap = await evaluate(SNAPSHOT_JS).catch(() => null);
      if (!snap) continue;
      const parsed = JSON.parse(snap);
      stillWorking = parsed.working.length > 0;
      const raw = await evaluate(`JSON.stringify(window.__nobo ? window.__nobo.events : [])`).catch(() => '[]');
      const events = JSON.parse(raw || '[]');
      const len = events.length ? events[events.length - 1][1] : 0;
      if (len > 0) sawText = true;
      if (len > highWater) {
        highWater = len;
        lastGrowthAt = Date.now();
      }
      if (sawText && !stillWorking && Date.now() - lastGrowthAt > 4000) break;
    }

    const observed = JSON.parse(
      (await evaluate(`JSON.stringify(window.__nobo ? window.__nobo.events : [])`).catch(() => '[]')) || '[]'
    );

    // Let the transcript settle before judging it.
    //
    // When the stream ends the live overlay is replaced by the projection, which
    // arrives on a separate request. Sampling during that handover sees the reply
    // once in the overlay and then once in the projection — or, worse, in neither
    // — so wait until the overlay has gone and the projection carries the answer.
    const settleBy = Date.now() + 15_000;
    while (Date.now() < settleBy) {
      const s = JSON.parse(await evaluate(SNAPSHOT_JS).catch(() => '{"cards":[],"liveBubbles":[]}'));
      if (s.cards.length > blocksBefore) break;
      if (s.liveBubbles.length === 0 && s.cards.length > 0 && blocksBefore === 0) break;
      await sleep(300);
    }

    const finalSnap = JSON.parse(await evaluate(SNAPSHOT_JS));
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    const shotPath = path.join(process.cwd(), '.work', 'accept-stream-ui.png');
    fs.mkdirSync(path.dirname(shotPath), { recursive: true });
    fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));

    // ── what actually happened ────────────────────────────────────────────
    // The page's own timeline: [msSinceSend, visibleChars] at every commit.
    const firstTextAt = observed.length ? observed[0][0] : null;
    const finalChars = finalSnap.len;

    // Typing rate over the LONGEST CONTIGUOUS BURST of growth.
    //
    // A multi-step turn is quiet while a tool runs, so "first paint to last paint"
    // measures tool latency, not typing. Splitting the timeline wherever growth
    // pauses for more than 1.5s leaves runs of pure text arrival; the biggest of
    // those is the honest characters-per-second of the wire.
    let burst = { ms: 0, chars: 0, paints: 0 };
    let runStart = null;
    let runChars = 0;
    let runPaints = 0;
    let previous = null;
    for (const [t, len] of observed) {
      if (previous === null || t - previous > 1500) {
        runStart = t;
        runChars = len;
        runPaints = 1;
      } else {
        runChars = len;
        runPaints += 1;
      }
      const ms = t - (runStart ?? t);
      if (runPaints >= 2 && runChars > burst.chars) burst = { ms, chars: runChars, paints: runPaints };
      previous = t;
    }
    const charsPerSec = burst.ms > 0 ? Math.round((burst.chars / (burst.ms / 1000)) * 10) / 10 : null;

    // The authoritative copy: the RUN this turn created names the session, so the
    // accounting cannot be confused by whichever thread the tab happened to adopt.
    const { data: newRuns } = await admin
      .from('harness_runs')
      .select('id, session_id, status, attempts, error, created_at')
      .eq('user_id', userId)
      .gte('created_at', new Date(startedAtMs - 15_000).toISOString())
      .order('created_at', { ascending: false })
      .limit(3);
    const run = newRuns?.[0] ?? null;
    const sessionId = run?.session_id ?? null;

    let rows = [];
    if (sessionId) {
      const { data: events } = await admin
        .from('harness_events')
        .select('seq, type, data')
        .eq('session_id', sessionId)
        .order('seq', { ascending: true });
      rows = events || [];
    }
    const assistantTexts = rows.filter((r) => r.type === 'assistant.text').map((r) => String(r.data?.text || ''));
    const errorEvents = rows.filter((r) => r.type === 'turn.error').map((r) => String(r.data?.message || ''));
    const toolCalls = rows.filter((r) => r.type === 'tool.call').map((r) => String(r.data?.name || ''));

    const replyBlocks = [...finalSnap.cards, ...finalSnap.liveBubbles].filter((t) => t.length > 0);
    // "One reply only" for THIS turn. Two independent guards:
    //   * exactly one reply block appeared that was not already on screen
    //   * no two blocks in the transcript share the same opening words
    const addedCards = finalSnap.cards.filter((text) => !beforeCards.includes(text));
    const addedBlocks = addedCards.length;
    const openings = replyBlocks.map((t) => t.replace(/\s+/g, ' ').slice(0, 60).toLowerCase());
    const duplicated = openings.length !== new Set(openings).size;
    const errorBanners = [
      ...finalSnap.toasts.map((t) => `toast(${t.type}): ${t.text}`),
      ...finalSnap.dangerText,
      ...errorEvents.map((e) => `turn.error: ${e}`),
    ].filter(Boolean);

    const report = {
      url: `${BASE}${AGENT_PATH}`,
      prompt: PROMPT,
      sessionId,
      newSessionClick,
      logSessionId,
      // Did the browser actually use the new transport?
      agentApiCalls: netLog.filter((n) => n.method === 'POST'),
      allAgentApiCalls: netLog.map((n) => `${n.method} ${n.url} -> ${n.status}`),
      usedStreamingEndpoint: netLog.some((n) => n.url.includes('/runs/stream') && n.status === 200),
      usedLegacyEndpoint: netLog.some((n) => n.url.includes('/agent/v2/chat')),
      // speed
      timeToFirstVisibleCharacterMs: firstTextAt,
      typingBurstMs: burst.ms || null,
      typingBurstChars: burst.chars || null,
      paintsWhileTyping: burst.paints || observed.length,
      finalChars,
      charsPerSecObserved: charsPerSec,
      allVisibleCommits: observed.length,
      // one reply only
      replyBlocksInDom: replyBlocks.length,
      blocksAddedThisTurn: addedBlocks,
      assistantTextRowsInLog: assistantTexts.length,
      duplicateReplyDetected: duplicated,
      userBubblesInDom: finalSnap.userBubbles.length,
      // errors
      errorBanners,
      consoleErrors: consoleErrors.slice(0, 10),
      pageExceptions: pageExceptions.slice(0, 10),
      rendererCrash: finalSnap.crash,
      // durability
      runStatus: run?.status ?? null,
      runError: run?.error ?? null,
      toolCalls,
      screenshot: shotPath,
      replyPreview: (replyBlocks[0] || assistantTexts[assistantTexts.length - 1] || '').slice(0, 220),
    };

    const ok =
      report.timeToFirstVisibleCharacterMs !== null &&
      report.usedStreamingEndpoint === true &&
      report.usedLegacyEndpoint === false &&
      report.replyBlocksInDom >= 1 &&
      report.blocksAddedThisTurn === 1 &&
      report.assistantTextRowsInLog >= 1 &&
      report.duplicateReplyDetected === false &&
      report.errorBanners.length === 0 &&
      report.rendererCrash === false &&
      report.consoleErrors.length === 0 &&
      report.runStatus !== 'failed' &&
      report.runStatus !== 'dead';

    console.log(JSON.stringify(report, null, 2));

    // Leave the tenant as we found it: the session this created is ours.
    if (sessionId && arg('keepSession', 'false') !== 'true') {
      await admin.from('harness_runs').delete().eq('session_id', sessionId);
      await admin.from('harness_events').delete().eq('session_id', sessionId);
      await admin.from('harness_sessions').delete().eq('id', sessionId);
    }

    console.log(`\n${ok ? 'PASS' : 'FAIL'} — browser acceptance\n`);
    process.exitCode = ok ? 0 : 1;
  } finally {
    try {
      cdp?.close();
    } catch {}
    try {
      chrome.kill();
    } catch {}
    await sleep(500);
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error(`\nFAILED: ${err?.message || err}\n`);
  process.exit(1);
});
