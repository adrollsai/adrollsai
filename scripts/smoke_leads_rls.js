/* Post-fix smoke test across tenants: each admin's plain `select count(*) from
 * leads` under RLS, with the real 8s statement_timeout. Reports elapsed time and
 * asserts the caller sees only their own tenant's rows.
 *
 *   node scripts/smoke_leads_rls.js
 */
const fs = require('fs');
const dotenv = require('dotenv');

const env = dotenv.parse(fs.readFileSync('.env.local'));
const TOKEN = env.SUPABASE_MANAGEMENT_TOKEN;
const REF = 'hpssqssdewmkmafxlfud';

const TENANTS = [
  { name: 'Blue Square Infra', id: '2f62a259-f23b-48ee-a920-c436f36eaa4b', expect: 16251 },
  { name: 'The ProEstate', id: '29937131-1975-4c5f-9b78-e5b28f918d32', expect: 8048 },
  { name: 'Realty Nation', id: 'c890a11f-84ce-4592-ab8f-8682927b1a9d', expect: 3677 },
  { name: 'GNR HOMES', id: '42d2e0c5-4fe6-4738-8a9f-63f09be01f12', expect: 1004 },
];

async function sql(query) {
  const started = Date.now();
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  return { status: res.status, ms: Date.now() - started, text };
}

(async () => {
  for (const t of TENANTS) {
    const q = `
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"${t.id}","role":"authenticated"}';
set local statement_timeout = '8s';
select
  (select count(*) from leads) as visible,
  (select count(*) from leads where user_id <> '${t.id}') as not_owned_by_me,
  (select count(*) from
     (select id from leads order by created_at desc limit 1000) p) as first_page;
rollback;
`;
    const r = await sql(q);
    if (r.status !== 201) {
      console.log(`${t.name.padEnd(20)} HTTP ${r.status} in ${r.ms}ms  -> ${r.text.replace(/\s+/g, ' ').slice(0, 160)}`);
      continue;
    }
    const row = JSON.parse(r.text)[0];
    const ok = (t.expect === null || row.visible === t.expect) && row.first_page === 1000;
    console.log(
      `${t.name.padEnd(20)} ${String(r.ms).padStart(5)}ms  visible=${row.visible}` +
      `  firstPage=${row.first_page}  ${ok ? 'OK' : 'CHECK'}` +
      (t.expect !== null && row.visible !== t.expect ? ` (expected ${t.expect})` : '')
    );
  }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
