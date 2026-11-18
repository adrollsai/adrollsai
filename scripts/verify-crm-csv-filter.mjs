/**
 * Does the CRM's new "CSV File / Imported List" filter actually filter?
 *
 * Drives the live CRM in headless Chrome over CDP: opens the Filters panel, reads
 * the CSV dropdown's options, picks one, and compares the count the page reports
 * with the count the database reports for that same tag â€” using the same rule the
 * page uses (a lead's csv_audience is a comma-separated list, so a match is "any
 * tag equals the file", case-insensitively).
 *
 *   npm run verify:crm-csv-filter
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
const PORT = Number(arg('port', '9226'));
const CHROME =
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(
    (p) => fs.existsSync(p)
  );
const admin = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}${detail === undefined ? '' : `  â€” ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail === undefined ? '' : `  â€” ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  }
};

async function signIn(userId) {
  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const user = userId ? users.users.find((u) => u.id === userId) : users.users.find((u) => u.email);
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

/**
 * The tenant to test against: one with CSV-imported leads, but not so many that
 * the CRM takes minutes to render in headless Chrome (the largest tenant here has
 * 16k, which made the whole check time out). Signing in as an arbitrary user makes
 * the assertions vacuous, which is how the first run "passed" while proving nothing.
 */
async function tenantWithCsvLeads() {
  const counts = new Map();
  for (let from = 0; from < 12000; from += 1000) {
    const { data } = await admin
      .from('leads')
      .select('user_id')
      .not('csv_audience', 'is', null)
      .order('id')
      .range(from, from + 999);
    if (!data?.length) break;
    for (const r of data) counts.set(r.user_id, (counts.get(r.user_id) || 0) + 1);
    if (data.length < 1000) break;
  }
  const eligible = [...counts.entries()]
    .filter(([, n]) => n >= 50 && n <= 2500)
    .sort((a, b) => b[1] - a[1]);
  const top = eligible[0] || [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) throw new Error('no tenant has CSV-imported leads');
  console.log(`tenant under test: ${top[0].slice(0, 8)} (${top[1]} leads with a CSV tag)`);
  return top[0];
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
      try { ws.close(); } catch {}
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
  const tenantId = arg('user') || (await tenantWithCsvLeads());
  const { userId, cookies } = await signIn(tenantId);

  // What the database says, by the same rule the page uses.
  const all = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data } = await admin.from('leads').select('id,csv_audience').eq('user_id', userId).order('id').range(from, from + 999);
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
  }
  const tagsOf = (raw) => String(raw || '').split(',').map((t) => t.trim()).filter(Boolean);
  const dbCounts = new Map();
  for (const l of all) for (const t of new Set(tagsOf(l.csv_audience))) dbCounts.set(t, (dbCounts.get(t) || 0) + 1);
  console.log(`\ndatabase: ${all.length} leads for this account, ${dbCounts.size} distinct CSV tags`);

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nobo-crm-'));
  const chrome = spawn(
    CHROME,
    ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`, '--no-first-run',
     '--disable-gpu', '--window-size=1280,900', 'about:blank'],
    { stdio: 'ignore' }
  );
  let cdp;
  const consoleErrors = [];
  try {
    await waitForHttp(`http://127.0.0.1:${PORT}/json/version`);
    const list = await waitForHttp(`http://127.0.0.1:${PORT}/json/list`);
    const page = (Array.isArray(list) ? list : []).find((t) => t.type === 'page');
    cdp = connect(page.webSocketDebuggerUrl);
    await cdp.opened;
    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p?.type !== 'error') return;
      consoleErrors.push((p.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 200));
    });
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

    await cdp.send('Page.navigate', { url: `${BASE}/dashboard/crm` });

    // Wait for the leads to be there before believing any count. The CRM paints
    // "Showing 0 matching leads" first, and the CSV filter only renders once the
    // account's leads have loaded — so the filter's own presence is the honest
    // readiness signal, and it is what the rest of this check needs anyway.
    const hasLabel = () =>
      evaluate(
        `Array.from(document.querySelectorAll('label')).some(l => /CSV File \\/ Imported List/i.test(l.innerText))`
      ).catch(() => false);
    const readCount = async () => {
      const text = await evaluate(
        `(() => { const m = document.body.innerText.match(/Showing\\s+([\\d,]+)\\s+matching leads/i); return m ? m[1] : null })()`
      ).catch(() => null);
      return { text, value: Number(String(text || '').replace(/,/g, '')) };
    };

    let ready = false;
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      await sleep(900);
      if (await hasLabel()) { ready = true; break; }
    }
    if (!ready) {
      // The panel may simply not be open yet; open it and look again.
      await evaluate(`(() => {
        const b = Array.from(document.querySelectorAll('button')).find(x => (x.innerText||'').trim().startsWith('Filters'));
        if (b) b.click();
        return true;
      })()`).catch(() => {});
      await sleep(2000);
      ready = await hasLabel();
    }
    check('leads loaded and the CSV filter rendered', ready === true);

    const initial = await readCount();
    const baseline = initial.value;
    check('the CRM reports a lead count', Number.isFinite(baseline) && baseline > 0, { count: initial.text });

    const labelFound = await evaluate(
      `Array.from(document.querySelectorAll('label')).some(l => /CSV File \\/ Imported List/i.test(l.innerText))`
    );
    check('the CSV File filter is present in the panel', labelFound === true);

    // open the CSV dropdown and read its options
    const options = await evaluate(`(async () => {
      try {
        const label = Array.from(document.querySelectorAll('label')).find(l => /CSV File \\/ Imported List/i.test(l.innerText));
        if (!label) return { error: 'no label' };
        const wrapper = label.closest('div');
        const trigger = wrapper && wrapper.querySelector('button');
        if (!trigger) return { error: 'no trigger' };
        trigger.click();
        await new Promise(r => setTimeout(r, 600));
        const rows = Array.from(wrapper.querySelectorAll('button')).map(b => (b.innerText || '').trim()).filter(Boolean);
        return { trigger: (trigger.innerText || '').trim(), rows };
      } catch (e) { return { error: String(e && e.message) }; }
    })()`);
    const rows = (options?.rows || []).filter(
      (r) => r && !/^All CSV files/i.test(r) && !/^Done$/i.test(r)
    );
    check('the dropdown lists CSV files', rows.length > 0, rows);
    check(
      'each option shows its lead count',
      rows.length > 0 && rows.every((r) => /\(\d+\)\s*$/.test(r)),
      rows.filter((r) => !/\(\d+\)\s*$/.test(r))
    );

    // pick the first real option
    const pickedLabel = rows[0];
    const pickedTag = String(pickedLabel).replace(/\s*\(\d+\)$/, '').trim();
    const dbExpected = dbCounts.get(pickedTag) ?? null;
    check(
      'the count shown next to the option matches the database',
      dbExpected !== null && String(pickedLabel).endsWith(`(${dbExpected})`),
      { shown: pickedLabel, database: dbExpected }
    );

    await evaluate(`(async () => {
      try {
        const label = Array.from(document.querySelectorAll('label')).find(l => /CSV File \\/ Imported List/i.test(l.innerText));
        const wrapper = label && label.closest('div');
        if (!wrapper) return 'no-wrapper';
        const row = Array.from(wrapper.querySelectorAll('button')).find(b => (b.innerText||'').trim() === ${JSON.stringify(pickedLabel)});
        if (row) { row.click(); return 'clicked'; }
        return 'row-not-found';
      } catch (e) { return 'error: ' + (e && e.message); }
    })()`);
    await sleep(1500);

    const afterText = await evaluate(
      `(() => { const m = document.body.innerText.match(/Showing\\s+([\\d,]+)\\s+matching leads/i); return m ? m[1] : null })()`
    );
    const after = Number(String(afterText || '').replace(/,/g, ''));
    check(
      `selecting "${pickedTag}" filters the list (${baseline} -> ${after})`,
      Number.isFinite(after) && after !== baseline && after > 0,
      { before: baseline, after }
    );
    check(
      'the filtered count equals the number of leads carrying that tag',
      after === dbExpected,
      { shown: after, database: dbExpected }
    );

    const chipVisible = await evaluate(`/CSV:\\s*/i.test(document.body.innerText)`);
    check('an active-filter chip names the chosen file', chipVisible === true);

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
    if (shot) {
      const file = path.join(process.cwd(), '.work', 'crm-csv-filter.png');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      console.log(`\nscreenshot: ${file}`);
    }

    check('no console errors on the CRM page', consoleErrors.length === 0, consoleErrors.slice(0, 3));
  } finally {
    try { cdp?.close(); } catch {}
    try { chrome.kill(); } catch {}
    await sleep(300);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  }

  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} â€” ${pass}/${pass + fail} checks passed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FAILED:', e?.message || e);
  process.exit(1);
});

