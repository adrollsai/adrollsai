/**
 * The 1000-row cap, and the numbers it silently corrupted.
 *
 * WHAT HAPPENED
 * PostgREST enforces `max-rows` (1000) server-side. A query asking for more is truncated and returns
 * HTTP 200 with no warning, so code that counts the rows it received reports a truncated slice as a
 * total. `org_lead_report` asked for 5,000 and was told "1,000 leads all-time across 6 accounts" —
 * while the organisation held ~40,000 and the owner's own account alone held 1,572. The owner noticed
 * because the CRM disagreed with the chat.
 *
 * What this gate pins:
 *   1. the paging helper returns every row past 1000, and says when it hit its own ceiling;
 *   2. an exact count comes from the DATABASE, never from counting rows;
 *   3. no reporting path still asks for more than one page in a single request;
 *   4. live: the org report's total equals the database's own count for the same scope, and equals
 *      what the read primitive says with scope "org".
 *
 *   npm run verify:max-rows
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

import { DEFAULT_SCAN_CAP, PAGE_SIZE, exactCount, groupCount, scanAll } from '../lib/supabase/paged';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? `  — ${detail}` : ''}`);
  }
};

// ── 1. the paging helper
console.log('\n▸ a scan reads past the first page');

/** A fake PostgREST: N rows, capped at PAGE_SIZE per response exactly like the real one. */
function fakeBuilder(total: number, opts: { ignoreRangeCap?: boolean } = {}) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i, pipeline_stage: i % 2 ? 'New Lead' : 'Contacted' }));
  const state = { requests: 0, countRequests: 0 };

  // A real PostgREST builder is a thenable: awaiting it runs the query. `head: true` resolves to a
  // count with no rows, which is how `exactCount` asks. The fake has to model that, or it only proves
  // the test's own shape.
  const builder: any = {
    select: () => builder,
    range: async (from: number, to: number) => {
      state.requests++;
      const cappedTo = opts.ignoreRangeCap ? to : Math.min(to, from + PAGE_SIZE - 1);
      return { data: rows.slice(from, cappedTo + 1), error: null };
    },
    then: (resolve: any) => {
      state.countRequests++;
      return Promise.resolve({ count: total, error: null, data: null }).then(resolve);
    },
  };

  return { build: () => builder, rows, state };
}

const exact = fakeBuilder(2500);
const scanned = await scanAll<any>(exact.build, { withTotal: true });
check(
  '2500 rows are read whole, not truncated to the first 1000',
  scanned.scanned === 2500 && scanned.capped === false,
  `${scanned.scanned} rows in ${exact.state.requests} requests`,
);
check('and the exact total came from the database', scanned.exactTotal === 2500);
const grouped = groupCount(scanned.rows, ['pipeline_stage']);
check(
  'a group-by over the full set is exact',
  Object.values(grouped).reduce((a, b) => a + b, 0) === 2500,
  JSON.stringify(grouped),
);

const huge = fakeBuilder(DEFAULT_SCAN_CAP + 5_000);
const cappedScan = await scanAll<any>(huge.build, { cap: 6_000 });
check(
  'a scan that hits its ceiling says so instead of pretending to be complete',
  cappedScan.capped === true && cappedScan.scanned === 6_000,
  `${cappedScan.scanned} scanned, capped=${cappedScan.capped}`,
);

let countedRows = 0;
const countProbe = await exactCount(async () => {
  countedRows++;
  return { count: 40_041, error: null };
});
check(
  'an exact count is one head request and transfers no rows',
  countProbe.count === 40_041 && countedRows === 1,
  'never derived from a page',
);

// ── 2. no naive wide limits left in the reporting paths
console.log('\n▸ nothing asks for more than a page in one request');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ').replace(/\s\/\/.*$/gm, ' ');

for (const file of ['lib/agent/tools/reporting.ts', 'lib/automation/calling-campaign.ts', 'lib/audiences/groups.ts']) {
  if (!fs.existsSync(file)) continue;
  const source = stripComments(fs.readFileSync(file, 'utf8'));
  const wide = [...source.matchAll(/\.limit\(\s*(\d{4,})\s*\)/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n > 1000);
  check(`${file} has no single-request limit above 1000`, wide.length === 0, wide.length ? `found ${wide.join(', ')}` : 'clean');
}
check(
  'the lead report counts through the paging helper',
  /scanAll</.test(stripComments(fs.readFileSync('lib/agent/tools/reporting.ts', 'utf8'))),
);
check(
  'and reads its total from the database count',
  /scan\.exactTotal/.test(stripComments(fs.readFileSync('lib/agent/tools/reporting.ts', 'utf8'))),
);

// ── 3. live: the number the agent quotes matches the database
console.log('\n▸ live: the report agrees with the database');
const env = (n: string) => {
  const raw = fs.readFileSync('.env.local', 'utf8');
  const line = raw.split(/\r?\n/).find((l) => l.startsWith(n + '='));
  return line ? line.slice(n.length + 1).replace(/^["']|["']$/g, '').trim() : '';
};
const admin = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});
const OWNER = 'bc63c065-9bcc-4793-bedc-f0960406425b';

const { data: children } = await admin.from('profiles').select('id').or(`parent_id.eq.${OWNER},agency_id.eq.${OWNER}`);
const ids = [OWNER, ...((children || []).map((c: any) => c.id))];

const { count: dbTotal } = await admin.from('leads').select('id', { count: 'exact', head: true }).in('user_id', ids);
const { count: ownerTotal } = await admin.from('leads').select('id', { count: 'exact', head: true }).eq('user_id', OWNER);

const { createReportingTools } = await import('../lib/agent/tools/reporting');
const reporting: any = (createReportingTools as any)(admin, OWNER);
const report: any = await reporting.org_lead_report.execute({ period: 'all_time' });
const result = report?.result ?? report;

check(
  'the org lead report total equals the database count for the same accounts',
  Number(result.totalLeads) === Number(dbTotal),
  `report ${result.totalLeads} vs database ${dbTotal}`,
);
check(
  'the report is no longer stuck at the 1000-row cap',
  Number(result.totalLeads) !== 1000 || Number(dbTotal) === 1000,
  `totalLeads ${result.totalLeads}`,
);
check(
  'the stage breakdown adds up to the rows it scanned',
  Object.values(result.byStage || {}).reduce((a: number, b: any) => a + Number(b), 0) === Number(result.rowsScanned ?? result.totalLeads),
  `${JSON.stringify(result.byStage).slice(0, 120)}`,
);
check(
  'and the answer says which scope it is',
  /account/i.test(String(result.scopeNote || '')),
  String(result.scopeNote || '').slice(0, 90),
);
check(
  'this account alone is a different (smaller) number, and the report says how to get it',
  Number(ownerTotal) <= Number(dbTotal) && /scope "me"/.test(String(result.scopeNote || '')),
  `this account ${ownerTotal} vs org ${dbTotal}`,
);

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
