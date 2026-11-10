// Captures real screenshots of the running Nobogent PWA at phone dimensions.
//
// This exists so the Flutter port can be built against what the web app actually
// renders, rather than against a reading of its source. It drives headless Chrome
// over the DevTools Protocol using only Node built-ins (no Puppeteer).
//
// Usage:
//   $env:NOBO_EMAIL="..."; $env:NOBO_PASSWORD="..."
//   node tools/shoot_pwa.mjs --base http://127.0.0.1:3000 --out ./pwa-shots
//
// Credentials are read from the environment and never written or logged.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = arg('base', 'http://127.0.0.1:3000');
const OUT = resolve(arg('out', 'pwa-shots'));
const EMAIL = process.env.NOBO_EMAIL ?? '';
const PASSWORD = process.env.NOBO_PASSWORD ?? '';
const PORT = Number(arg('port', '9222'));
const WIDTH = Number(arg('width', '412'));
const HEIGHT = Number(arg('height', '915'));
const SCALE = Number(arg('scale', '2'));

const PAGES = [
  ['01-login', '/login'],
  ['02-dashboard', '/dashboard'],
  ['03-analytics', '/dashboard/analytics'],
  ['04-agent', '/dashboard/agent'],
  ['05-creation', '/dashboard/creation'],
  ['06-crm', '/dashboard/crm'],
  ['07-assets', '/dashboard/assets'],
  ['08-notifications', '/dashboard/notifications'],
  ['09-profile', '/dashboard/profile'],
  ['10-ads', '/dashboard/ads'],
  ['11-gbp', '/dashboard/gbp'],
  ['12-whatsapp', '/dashboard/whatsapp'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error(`timeout: ${method}`));
        }
      }, 45000);
    });
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(`eval failed: ${r.exceptionDetails.text} :: ${expression.slice(0, 120)}`);
    }
    return r.result?.value;
  }
}

async function findPageTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* chrome not up yet */
    }
    await sleep(400);
  }
  throw new Error('no page target found');
}

function launchChrome(userDir) {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const bin = candidates.find((p) => existsSync(p));
  if (!bin) throw new Error('no Chrome/Edge binary found');

  const child = spawn(
    bin,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${userDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      'about:blank',
    ],
    { stdio: 'ignore', detached: false },
  );
  return { child, bin };
}

/** Sets a React-controlled input's value so React sees the change. */
const setInput = (selector, value) => `
(() => {
  const el = ${selector};
  if (!el) return false;
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  el.focus();
  desc.set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`;

const main = async () => {
  mkdirSync(OUT, { recursive: true });
  const userDir = join(tmpdir(), `nobo-cdp-${Date.now()}`);
  mkdirSync(userDir, { recursive: true });

  const { child, bin } = launchChrome(userDir);
  console.log(`chrome: ${bin}`);

  try {
    const target = await findPageTarget();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const cdp = new Cdp(ws);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: SCALE,
      mobile: true,
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Emulation.setUserAgentOverride', {
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/156.0.0.0 Mobile Safari/537.36',
    });

    const shoot = async (name) => {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
      console.log(`  shot ${name}`);
    };

    const goto = async (path) => {
      await cdp.send('Page.navigate', { url: `${BASE}${path}` });
      await sleep(1200);
      for (let i = 0; i < 40; i++) {
        const ready = await cdp.eval(`document.readyState === 'complete'`);
        if (ready) break;
        await sleep(300);
      }
      await sleep(2200); // let client components hydrate and fetch
    };

    // --- log in -----------------------------------------------------------------
    if (EMAIL && PASSWORD) {
      console.log('logging in…');
      await goto('/login');
      const filledEmail = await cdp.eval(setInput(`document.querySelector('input[type="email"]') || document.querySelectorAll('input')[0]`, EMAIL));
      const filledPass = await cdp.eval(setInput(`document.querySelector('input[type="password"]')`, PASSWORD));
      console.log(`  email field: ${filledEmail}, password field: ${filledPass}`);

      await cdp.eval(`
        (() => {
          const btns = [...document.querySelectorAll('button')];
          const b = btns.find(x => /sign\\s*in/i.test(x.textContent || ''));
          if (b) { b.click(); return 'clicked'; }
          const form = document.querySelector('form');
          if (form) { form.requestSubmit(); return 'submitted'; }
          return 'no submit control';
        })()`);

      let ok = false;
      for (let i = 0; i < 45; i++) {
        await sleep(900);
        const path = await cdp.eval('location.pathname');
        if (path && !path.startsWith('/login')) {
          ok = true;
          console.log(`  signed in -> ${path}`);
          break;
        }
      }
      if (!ok) {
        const err = await cdp.eval(`document.body.innerText.slice(0, 300)`);
        console.log(`  WARN: still on /login. Page text: ${JSON.stringify(err)}`);
      }
    } else {
      console.log('NOBO_EMAIL / NOBO_PASSWORD not set — capturing public pages only');
    }

    for (const [name, path] of PAGES) {
      if (!EMAIL && !name.includes('login')) continue;
      await goto(path);
      const path2 = await cdp.eval('location.pathname');
      const h1 = await cdp.eval(`(document.querySelector('h1')?.innerText || '').slice(0,60)`);
      console.log(`  ${name}: path=${path2} h1=${JSON.stringify(h1)}`);
      await shoot(name);
    }

    ws.close();
  } finally {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    await sleep(600);
    try {
      rmSync(userDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
};

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
