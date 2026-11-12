/* Validates the shipped migration before it is applied.
 *
 * Runs the real migration file inside a transaction against the live DB,
 * exercises it as BOTH an admin and a low-privilege agent, asserts tenant
 * isolation still holds, then ROLLBACKs. Nothing is persisted.
 *
 *   node scripts/validate_leads_fix.js
 */
const fs = require('fs');
const dotenv = require('dotenv');

const env = dotenv.parse(fs.readFileSync('.env.local'));
const TOKEN = env.SUPABASE_MANAGEMENT_TOKEN;
const REF = 'hpssqssdewmkmafxlfud';

const ADMIN = '2f62a259-f23b-48ee-a920-c436f36eaa4b';      // infobluesquareinfra (admin)
const AGENT = 'd9c567eb-1b2d-43bc-bbbc-33e0b8d05e83';      // sonambluesquarreinfra (agent)
const WORKSPACE = [
  '2f62a259-f23b-48ee-a920-c436f36eaa4b', 'd9c567eb-1b2d-43bc-bbbc-33e0b8d05e83',
  '46b07e70-637b-4381-8523-8db5b764b4a6', '66c4d255-db7c-4bf6-b442-cc2ca446d14a',
  '4f0f8667-d56c-498b-a4cc-1260e722c2e1', 'a2a09a5e-8a30-4bfa-81f3-53b48a27e8fc',
  '59dd14ee-8af1-47fe-bec0-3b2d8914f4fe', 'ac1d3d22-1c96-462f-b2b5-9bc26ada4bab',
  '07db7180-6fac-4055-86ee-8b3748590f56', 'ef43e688-6481-4e92-9a61-87183bee128c',
  'f88a0f59-be26-4a5f-ace8-9c30549f7c03', '68883e34-9f71-4f9e-9c66-4338b90e9384',
  '1e4780ac-4e5b-40d0-bb0f-bea7145259d1',
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

function ddlFromMigration() {
  const raw = fs.readFileSync(
    'supabase/migrations/20261112120000_fix_leads_rls_performance.sql', 'utf8');
  // strip the file's own transaction wrapper; the validator supplies its own
  return raw
    .replace(/^\s*begin\s*;/im, '')
    .replace(/^\s*commit\s*;\s*$/im, '');
}

function orFilter() {
  return WORKSPACE.flatMap((id) => [`user_id='${id}'`, `assigned_to='${id}'`]).join('\n   or ');
}

async function main() {
  // A lead belonging to somebody outside this workspace: must stay invisible.
  const foreign = await sql(
    `select id from leads where user_id not in (${WORKSPACE.map((w) => `'${w}'`).join(',')}) limit 1;`);
  const foreignId = JSON.parse(foreign.text)[0].id;
  console.log(`foreign lead used for the isolation assertion: ${foreignId}\n`);

  const cases = [
    { name: 'admin', sub: ADMIN, expectCount: 16251 },
    { name: 'agent', sub: AGENT, expectCount: null },
  ];

  for (const c of cases) {
    const script = `
begin;
${ddlFromMigration()}
set local role authenticated;
set local request.jwt.claims = '{"sub":"${c.sub}","role":"authenticated"}';
set local statement_timeout = '8s';
select
  (select count(*) from leads) as visible_leads,
  (select count(*) from leads where id = '${foreignId}') as foreign_visible_must_be_0,
  (select count(*) from (
     select id from leads
     where (${orFilter()})
     order by created_at desc limit 1000) t) as first_page_rows,
  (select count(*) from leads where assigned_to is not null) as assigned_rows_visible;
rollback;
`;
    const r = await sql(script);
    console.log(`=== ${c.name} (${c.sub}) ===`);
    console.log(`  HTTP ${r.status} in ${r.ms}ms`);
    if (r.status !== 201) {
      console.log('  ' + r.text.slice(0, 600));
    } else {
      const row = JSON.parse(r.text)[0];
      console.log(`  ${JSON.stringify(row)}`);
      if (row.foreign_visible_must_be_0 !== 0) {
        console.log('  !! SECURITY REGRESSION: foreign lead is visible');
      } else {
        console.log('  isolation OK (foreign lead invisible)');
      }
      if (c.expectCount !== null && row.visible_leads !== c.expectCount) {
        console.log(`  !! expected ${c.expectCount} visible leads`);
      }
    }
    console.log('');
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
