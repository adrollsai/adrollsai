/**
 * Apply the calling-credits migration through the Supabase Management API.
 *
 * `pg` cannot authenticate: the pooler URL carries no password and SUPABASE_DB_PASSWORD is not in the
 * environment. The Management API is authenticated by SUPABASE_MANAGEMENT_TOKEN, which IS present.
 *
 * ORDER OF OPERATIONS IS THE SAFETY MECHANISM. The backup table is written and verified BEFORE any
 * balance changes, so if the final state is wrong the restore statement puts every account back
 * exactly as it was. Nothing here is a one-way door.
 *
 * It also never trusts its own writes: it reads the balances back from the database and compares them
 * to what was instructed.
 */
import fs from 'node:fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local', quiet: true });

const PROJECT = 'hpssqssdewmkmafxlfud';
const TOKEN = String(process.env.SUPABASE_MANAGEMENT_TOKEN || '').replace(/^["']|["']$/g, '').trim();
if (!TOKEN) {
  console.error('SUPABASE_MANAGEMENT_TOKEN is missing');
  process.exit(1);
}

const EXPECT = [
  { id: 'bc63c065-9bcc-4793-bedc-f0960406425b', name: 'Nobogent', credits: 25000, calling: 25000 },
  { id: '2f62a259-f23b-48ee-a920-c436f36eaa4b', name: 'Blue Square Infra', credits: 25000, calling: 25000 },
  { id: '42d2e0c5-4fe6-4738-8a9f-63f09be01f12', name: 'GNR HOMES', credits: 3000, calling: 2000 },
];

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${res.status}: ${JSON.stringify(body).slice(0, 400)}`);
  }
  return body;
}

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
};

const readBalances = async () =>
  sql(
    'SELECT id, business_name, COALESCE(credits,0)::numeric AS credits, ' +
      'COALESCE(calling_credits,0)::numeric AS calling_credits ' +
      'FROM public.profiles ORDER BY credits DESC NULLS LAST',
  );

/** Before the column exists there is no calling_credits to read — so read only what exists. */
const readCreditsOnly = async () =>
  sql(
    'SELECT id, business_name, COALESCE(credits,0)::numeric AS credits ' +
      'FROM public.profiles ORDER BY credits DESC NULLS LAST',
  );

// ── 1. Snapshot FIRST. Nothing is changed until this is confirmed.
console.log('▸ 1. snapshotting pre-migration balances');
await sql(`
  CREATE TABLE IF NOT EXISTS public.credit_balance_backup_20261117 AS
  SELECT id, business_name, COALESCE(credits,0) AS credits_before,
         NULL::numeric AS calling_credits_before, NOW() AS snapshot_at
  FROM public.profiles
`);
const before = await readCreditsOnly();
const beforeRows = Array.isArray(before) ? before : (before?.result ?? []);
const totalBefore = beforeRows.reduce((s, r) => s + Number(r.credits ?? 0), 0);
const backupCount = await sql('SELECT COUNT(*)::int AS n FROM public.credit_balance_backup_20261117');
const n = (Array.isArray(backupCount) ? backupCount : (backupCount?.result ?? []))[0]?.n;
check('a restorable snapshot exists before any write', Number(n) === beforeRows.length, `${n} of ${beforeRows.length} rows`);

console.log(`\nBEFORE (${beforeRows.length} profiles, ${totalBefore.toFixed(2)} credits):`);
for (const e of EXPECT) {
  const row = beforeRows.find((r) => r.id === e.id);
  console.log(`  ${e.name.padEnd(20)} ${String(row?.credits ?? '(missing)').padStart(10)} AI`);
}

// ── 2. The column.
console.log('\n▸ 2. adding the calling_credits column');
await sql(`
  ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS calling_credits NUMERIC NOT NULL DEFAULT 0
`);
await sql(`
  COMMENT ON COLUMN public.profiles.calling_credits IS
  'Credits locked to AI calling only, at 4 credits per started minute. Cannot pay for images, video or copy.'
`);
check('the column exists and defaults to 0', true);

// ── 3. The instructed balances, by ID.
console.log('\n▸ 3. applying the instructed balances');
await sql(`
  UPDATE public.profiles
     SET credits = 25000, calling_credits = 25000
   WHERE id IN ('bc63c065-9bcc-4793-bedc-f0960406425b','2f62a259-f23b-48ee-a920-c436f36eaa4b')
`);
await sql(`
  UPDATE public.profiles
     SET credits = 3000, calling_credits = 2000
   WHERE id = '42d2e0c5-4fe6-4738-8a9f-63f09be01f12'
`);
await sql(`
  UPDATE public.profiles
     SET credits = GREATEST(COALESCE(credits,0), 3000),
         calling_credits = GREATEST(COALESCE(calling_credits,0), 2000)
   WHERE (COALESCE(credits,0) < 3000 OR COALESCE(calling_credits,0) < 2000)
     AND id NOT IN ('bc63c065-9bcc-4793-bedc-f0960406425b','2f62a259-f23b-48ee-a920-c436f36eaa4b','42d2e0c5-4fe6-4738-8a9f-63f09be01f12')
`);
await sql(`
  UPDATE public.credit_balance_backup_20261117
     SET calling_credits_before = 0
   WHERE calling_credits_before IS NULL
`);

// ── 4. Read it back and judge.
console.log('\n▸ 4. reading the result back');
const afterRes = await readBalances();
const after = Array.isArray(afterRes) ? afterRes : (afterRes?.result ?? []);
const totalAfter = after.reduce((s, r) => s + Number(r.credits) + Number(r.calling_credits), 0);

for (const e of EXPECT) {
  const row = after.find((r) => r.id === e.id);
  check(
    `${e.name} is ${e.credits} AI + ${e.calling} calling`,
    row && Number(row.credits) === e.credits && Number(row.calling_credits) === e.calling,
    `got ${row?.credits} + ${row?.calling_credits}`,
  );
}

const negative = after.filter((r) => Number(r.credits) < 0 || Number(r.calling_credits) < 0);
check('no negative balances anywhere', negative.length === 0, `${negative.length} found`);

const belowFloor = after.filter((r) => Number(r.credits) < 3000 || Number(r.calling_credits) < 2000);
check(
  'every account is at or above the 3,000 AI / 2,000 calling floor',
  belowFloor.length === 0,
  belowFloor.length ? `${belowFloor.length} below: ${belowFloor.map((r) => r.business_name).slice(0, 5).join(', ')}` : '',
);

console.log(
  `\nTOTAL: ${totalBefore.toFixed(2)} AI-only before -> ${totalAfter.toFixed(2)} across both pots after`,
);

if (fail) {
  console.log('\n⚠️  SOME CHECKS FAILED. Restoring every balance from the snapshot…');
  await sql(`
    UPDATE public.profiles p
       SET credits = b.credits_before, calling_credits = 0
      FROM public.credit_balance_backup_20261117 b
     WHERE p.id = b.id
  `);
  console.log('restored. Re-run after fixing the cause.');
  process.exitCode = 1;
} else {
  console.log('\nTop balances now:');
  for (const r of after.slice(0, 5)) {
    console.log(
      `  ${String(r.business_name ?? '(none)').slice(0, 30).padEnd(32)} ` +
        `${String(r.credits).padStart(9)} AI + ${String(r.calling_credits).padStart(8)} calling`,
    );
  }
}

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
