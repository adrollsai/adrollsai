/**
 * The four UI changes, checked in a real browser against the deployed app.
 *
 * Each of these is a claim about something a person SEES, so asserting the source code would prove
 * nothing:
 *   1. the distribution modal marks each campaign green (delivering) or red (not);
 *   2. the bulk-transfer "From Owner / Agent" control accepts MORE THAN ONE source;
 *   3. Team management offers an edit path for a member's name, email and password;
 *   4. a CRM filter survives opening a lead and coming back.
 *
 * (4) is checked the way the app does it — write what the filter effect writes, reload the page, and
 * look at what the page came back with — because navigating into a lead unmounts the CRM exactly as a
 * reload does. Nothing here sends a message, spends money or changes a team member.
 *
 *   npm run accept:ui-additions
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

const BASE = arg('base', 'https://app.pipixel.io');
const OWNER = arg('user', 'bc63c065-9bcc-4793-bedc-f0960406425b');
const PORT = Number(arg('port', '9233'));
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

async function main() {
  if (!CHROME) throw new Error('no Chrome/Edge found');
  const cookies = await signIn(OWNER);

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nobo-ui-'));
  const chrome = spawn(
    CHROME,
    ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`, '--no-first-run',
     '--disable-gpu', '--window-size=1440,1000', 'about:blank'],
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
    const text = () => evaluate('document.body ? document.body.innerText : ""').catch(() => '');
    const clickByText = (needle, tag = 'button') =>
      evaluate(`(() => {
        const els = Array.from(document.querySelectorAll('${tag}'));
        const hit = els.find(el => (el.innerText || '').toLowerCase().includes(${JSON.stringify(String(needle).toLowerCase())}));
        if (!hit) return false;
        hit.click();
        return true;
      })()`).catch(() => false);

    // ── 4. CRM filter survives leaving the page (checked first: it needs no other setup)
    console.log('\n1. a CRM filter survives opening a lead and coming back');
    await cdp.send('Page.navigate', { url: `${BASE}/dashboard/crm` });
    await sleep(9000);
    const crmReady = /crm|lead/i.test(await text());
    check('the CRM page loaded', crmReady);

    const stamp = `ui-check-${Date.now().toString(36)}`;
    await evaluate(`(() => {
      localStorage.setItem('crm_filter_search', ${JSON.stringify(stamp)});
      sessionStorage.setItem('crm_filter_search', ${JSON.stringify(stamp)});
      localStorage.setItem('crm_filter_campaigns', JSON.stringify(['UI Check Campaign']));
      sessionStorage.setItem('crm_filter_campaigns', JSON.stringify(['UI Check Campaign']));
      localStorage.setItem('crm_show_filters', 'true');
      sessionStorage.setItem('crm_show_filters', 'true');
      return true;
    })()`);
    await cdp.send('Page.reload', { ignoreCache: false });
    await sleep(9000);
    const restored = await evaluate(`(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      const search = inputs.find(i => (i.placeholder || '').toLowerCase().includes('search'));
      return {
        searchValue: search ? search.value : null,
        bodyHasFilter: /UI Check Campaign/.test(document.body.innerText),
      };
    })()`).catch(() => null);
    check(
      'the search text comes back after the page is re-entered',
      String(restored?.searchValue ?? '') === stamp,
      restored
    );
    check('the campaign filter is applied on return, not forgotten', restored?.bodyHasFilter === true, restored);
    await evaluate(`(() => {
      ['crm_filter_search','crm_filter_campaigns','crm_show_filters'].forEach(k => {
        localStorage.removeItem(k); sessionStorage.removeItem(k);
      });
      return true;
    })()`);

    // ── 2. bulk transfer accepts several sources
    console.log('\n2. the bulk-transfer modal can take more than one source');
    await cdp.send('Page.navigate', { url: `${BASE}/dashboard/crm` });
    await sleep(9000);
    let openedTransfer = await clickByText('transfer');
    if (!openedTransfer) openedTransfer = await clickByText('bulk');
    await sleep(1500);
    const modalVisible = /select filter criteria|source leads/i.test(await text());
    if (!openedTransfer || !modalVisible) {
      // The filtered-transfer modal lives behind the filter panel's bulk action; try that path.
      await clickByText('filters');
      await sleep(1200);
      await clickByText('transfer');
      await sleep(1500);
    }
    const transferOpen = /select filter criteria|source leads/i.test(await text());
    check('the bulk transfer modal opens', transferOpen);

    if (transferOpen) {
      // Open the From Owner / Agent control (the first searchable select in the criteria grid).
      const openedControl = await evaluate(`(() => {
        const labels = Array.from(document.querySelectorAll('label'));
        const label = labels.find(l => /from owner/i.test(l.innerText || ''));
        if (!label) return 'no-label';
        const wrap = label.parentElement;
        const btn = wrap && wrap.querySelector('button');
        if (!btn) return 'no-button';
        btn.click();
        return 'clicked';
      })()`).catch(() => 'error');
      await sleep(900);
      const multi = await evaluate(`(() => {
        // Walk UP from the search input to the panel card: the input's own wrapper also contains the
        // input, so "the last div containing it" is the wrong node. The card is the nearest ancestor
        // that holds the option rows.
        const input = Array.from(document.querySelectorAll('input')).find(i => (i.placeholder || '').includes('Search team'));
        if (!input) return { error: 'no search box' };
        let node = input;
        for (let i = 0; i < 6 && node; i++) {
          node = node.parentElement;
          if (!node) break;
          const rows = Array.from(node.querySelectorAll('button')).filter(b => /👤/.test(b.innerText || ''));
          if (rows.length >= 2) {
            const tickBoxes = node.querySelectorAll('span[aria-hidden].rounded-md.border').length;
            rows[0].click();
            return { tickBoxes, rowCount: rows.length, firstName: (rows[0].innerText || '').trim() };
          }
        }
        return { error: 'no option rows found' };
      })()`).catch(() => null);
      await sleep(600);
      const secondPick = await evaluate(`(() => {
        const input = Array.from(document.querySelectorAll('input')).find(i => (i.placeholder || '').includes('Search team'));
        if (!input) return { error: 'panel closed after the first pick' };
        let node = input;
        for (let i = 0; i < 6 && node; i++) {
          node = node.parentElement;
          if (!node) break;
          const rows = Array.from(node.querySelectorAll('button')).filter(b => /👤/.test(b.innerText || ''));
          if (rows.length >= 2) {
            const notYet = rows.find(b => !b.querySelector('span[aria-hidden].bg-blue-600'));
            if (!notYet) return { error: 'no unselected row left', rowCount: rows.length };
            notYet.click();
            return { second: (notYet.innerText || '').trim(), rowCount: rows.length };
          }
        }
        return { error: 'panel lost' };
      })()`).catch(() => null);
      await sleep(700);
      const triggerLabel = await evaluate(`(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const hit = btns.find(b => /selected$/i.test((b.innerText || '').trim()));
        return hit ? (hit.innerText || '').trim() : null;
      })()`).catch(() => null);
      check('the source control renders multi-select tick boxes', (multi?.tickBoxes ?? 0) > 0, multi);
      check('the panel stays open while picking', !secondPick?.error, secondPick);
      check(
        'picking two sources keeps both',
        /2 selected/.test(String(triggerLabel ?? '')),
        triggerLabel ?? JSON.stringify({ multi, secondPick })
      );
    }

    // ── 1. distribution modal campaign dots
    console.log('\n3. the distribution modal marks campaigns active or inactive');
    await cdp.send('Page.navigate', { url: `${BASE}/dashboard/crm` });
    await sleep(9000);
    let openedDistribution = await clickByText('distribution');
    if (!openedDistribution) openedDistribution = await clickByText('group');
    await sleep(2000);
    const distributionOpen = /distribution groups|weighted round-robin/i.test(await text());
    check('the distribution modal opens', distributionOpen);
    if (distributionOpen) {
      // The modal paints its groups after its fetch, so poll rather than sleeping a fixed amount:
      // open the campaign picker (it shows the most dots) and look for a typed status dot.
      const dotProbe = `(() => {
        const labelled = Array.from(document.querySelectorAll('span.rounded-full[title]'));
        const green = labelled.filter(s => String(s.className).includes('bg-emerald-500')).length;
        const red = labelled.filter(s => String(s.className).includes('bg-rose-500')).length;
        return { green, red, titles: labelled.map(s => s.getAttribute('title')).slice(0, 4) };
      })()`;
      let dots = await evaluate(dotProbe).catch(() => null);
      for (let attempt = 0; attempt < 8 && ((dots?.green ?? 0) + (dots?.red ?? 0)) === 0; attempt++) {
        await evaluate(`(() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => /add .*campaign/i.test(b.innerText || ''));
          if (btn) btn.click();
          return true;
        })()`).catch(() => false);
        await sleep(1200);
        dots = await evaluate(dotProbe).catch(() => null);
      }
      check('campaign status dots are rendered', (dots?.green ?? 0) + (dots?.red ?? 0) > 0, dots);
      check(
        'the dots say what they mean',
        (dots?.titles ?? []).some((t) => /delivering/i.test(String(t))),
        dots?.titles
      );
    }

    // ── 3. team member editing
    console.log('\n4. team management can edit a member');
    await cdp.send('Page.navigate', { url: `${BASE}/dashboard/team` });
    await sleep(9000);
    const teamText = await text();
    check('the team page loaded', /team|manage/i.test(teamText));
    const editButton = await evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => (b.title || '').toLowerCase().includes('edit name'));
      return btn ? 'found' : 'missing';
    })()`).catch(() => 'error');
    check('each member offers an edit control', editButton === 'found', editButton);
    if (editButton === 'found') {
      await evaluate(`(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => (b.title || '').toLowerCase().includes('edit name'));
        btn && btn.click();
        return true;
      })()`);
      await sleep(900);
      const fields = await evaluate(`(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        return {
          hasName: inputs.some(i => i.type === 'text'),
          hasEmail: inputs.some(i => i.type === 'email'),
          hasPassword: inputs.some(i => i.type === 'password'),
          heading: (document.body.innerText.match(/Edit Team Member/i) || [])[0] || null,
        };
      })()`).catch(() => null);
      check('the edit modal offers name, email and password', Boolean(fields?.hasName && fields?.hasEmail && fields?.hasPassword), fields);
      // Close without saving: this run must not change anybody's login.
      await clickByText('cancel');
      await sleep(400);
      const closed = !/Edit Team Member/i.test(await text());
      check('cancel closes without saving', closed);
    }

    // The route's own guards, without touching a real member's login.
    const unauthorised = await fetch(`${BASE}/api/team/update`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: OWNER, name: 'nope' }),
    });
    check('the update route refuses an anonymous caller', unauthorised.status === 401, unauthorised.status);

    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const callUpdate = async (payload) => {
      const res = await fetch(`${BASE}/api/team/update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: cookieHeader },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body };
    };

    const self = await callUpdate({ memberId: OWNER, name: 'Owner Renamed By Test' });
    check('an admin cannot edit their own login from here', self.status === 400 && /account settings/i.test(String(self.body?.error ?? '')), self);

    const shortPassword = await callUpdate({ memberId: OWNER, password: 'short' });
    check('a password under 8 characters is refused', shortPassword.status === 400, shortPassword);

    const badEmail = await callUpdate({ memberId: OWNER, email: 'not-an-email' });
    check('a malformed email is refused before anything is written', badEmail.status === 400, badEmail);

    // A real member of this workspace, asked to keep the name they already have: this exercises the
    // authorisation and the profile write without changing a single value, and never touches auth.
    const { data: memberRow } = await admin
      .from('profiles')
      .select('id, full_name, business_name, parent_id')
      .eq('parent_id', OWNER)
      .in('role', ['admin', 'agent'])
      .limit(1)
      .maybeSingle();
    if (memberRow?.id) {
      const sameName = String(memberRow.full_name || memberRow.business_name || '').trim();
      const noop = await callUpdate({ memberId: memberRow.id, name: sameName });
      check(
        'the update route accepts a real member and reports what it wrote',
        noop.status === 200 && Array.isArray(noop.body?.changed) && noop.body.changed.includes('name'),
        noop
      );
    } else {
      console.log('  skip  no team member in this workspace to exercise the write path against');
    }
  } finally {
    try {
      cdp?.close();
    } catch {}
    try {
      chrome.kill();
    } catch {}
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  }
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exit(1);
});
