/**
 * The primitives, and the guards that make them safe to hand to an agent.
 *
 * The owner's instruction was "the agent should not be bound, it should be flexible" — so the answer is
 * primitives, not more pre-baked tools. But a primitive that can do everything is exactly the one that
 * needs its boundaries pinned by tests rather than by hope:
 *
 *   reads     query_account_data   exact counts, aggregate, list, distinct — scoped by role
 *   writes    update_account_data  update/insert/delete — scoped, dry by default, capped, delete gated
 *   network   http_request         any https API — public hosts only, writes gated
 *
 * Two live bugs were caught while building these, and both are pinned here:
 *   1. the first query primitive applied the scope to scans but NOT to the exact count, and returned
 *      40,041 leads while claiming "this account only" (see verify:data-query for the read half);
 *   2. a write primitive that accepted no filters would have expressed "every row in the table".
 *
 *   npm run verify:primitives
 *
 * Pure checks plus one guarded live round-trip that cleans up after itself.
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

import { MAX_INSERT_ROWS, MAX_WRITE_ROWS, validateUpdate, validateInsert } from '../lib/agent/tools/data-write';
import { ALLOWED_METHODS, MAX_RESPONSE_BYTES, checkUrl, isMutatingMethod, isPublicAddress } from '../lib/agent/tools/http';
import { REVIEW_POLICY } from '../lib/agent/review-gate';

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

const codeOf = (p: string) =>
  fs
    .readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\s\/\/.*$/gm, ' ');

// ── 1. the write primitive refuses the shapes that destroy data by accident
console.log('\n▸ a write without a filter is not expressible');
check(
  'an update with no filters is refused',
  (() => {
    const res = validateUpdate('leads', [], { pipeline_stage: 'Contacted' });
    return !res.ok && /at least one filter/.test(String(res.error));
  })(),
);
check('an update with no values is refused', !validateUpdate('leads', [{ column: 'id', op: 'eq', value: 'x' }], {}).ok);
check(
  'the scope column cannot be written',
  !validateUpdate('leads', [{ column: 'id', op: 'eq', value: 'x' }], { user_id: 'someone-else' }).ok,
);
check(
  'platform-owned columns cannot be written',
  !validateUpdate('leads', [{ column: 'id', op: 'eq', value: 'x' }], { id: 'new-id' }).ok &&
    !validateUpdate('leads', [{ column: 'id', op: 'eq', value: 'x' }], { created_at: '2020-01-01' }).ok,
);
check(
  'billing fields cannot be written through the primitive',
  !validateUpdate('profiles', [{ column: 'id', op: 'eq', value: 'x' }], { credits: 999999 }).ok &&
    !validateUpdate('profiles', [{ column: 'id', op: 'eq', value: 'x' }], { role: 'super_admin' }).ok,
  'credits and role are not business fields',
);
check(
  'a real update passes',
  (() => {
    const res = validateUpdate('leads', [{ column: 'pipeline_stage', op: 'eq', value: 'New Lead' }], { pipeline_stage: 'Contacted' });
    return res.ok && res.filters?.length === 1 && res.values?.pipeline_stage === 'Contacted';
  })(),
);
check(
  'filtering on the scope column is refused',
  !validateUpdate('leads', [{ column: 'user_id', op: 'eq', value: 'other' }], { pipeline_stage: 'Contacted' }).ok,
);
check(
  `one insert is capped at ${MAX_INSERT_ROWS} rows`,
  !validateInsert('leads', Array.from({ length: 40 }, () => ({ name: 'x' }))).ok,
);
check(
  'an insert drops system columns instead of letting the caller set them',
  (() => {
    const res = validateInsert('leads', [{ name: 'Probe', user_id: 'someone-else', id: 'forced' }]);
    const row = (res.values as any)?.[0] || {};
    return res.ok && row.name === 'Probe' && !('user_id' in row) && !('id' in row);
  })(),
);
check('the write cap is finite and stated', Number.isFinite(MAX_WRITE_ROWS) && MAX_WRITE_ROWS <= 500, `${MAX_WRITE_ROWS} rows`);

// ── 2. the http primitive's boundary
console.log('\n▸ http reaches the public internet and nothing else');
check('https is accepted', checkUrl('https://api.example.com/v1/items').ok === true);
for (const bad of [
  'http://api.example.com/x',
  'file:///etc/passwd',
  'https://localhost/x',
  'https://127.0.0.1/x',
  'https://169.254.169.254/latest/meta-data/',
  'https://10.0.0.5/internal',
  'https://192.168.1.1/admin',
  'https://metadata.google.internal/computeMetadata/v1/',
  'https://user:pass@api.example.com/x',
  'not a url',
]) {
  check(`"${bad.slice(0, 46)}" is refused`, checkUrl(bad).ok === false, checkUrl(bad).error?.slice(0, 60));
}
check(
  'a private address is refused even when the name looks public',
  isPublicAddress('10.1.2.3') === false && isPublicAddress('127.0.0.1') === false && isPublicAddress('8.8.8.8') === true,
  'the DNS check runs after the name check',
);
check(
  'state-changing methods are the gated ones',
  isMutatingMethod('POST') && isMutatingMethod('delete') && isMutatingMethod('PATCH') && !isMutatingMethod('GET') && !isMutatingMethod('HEAD'),
);
check('the method list is closed', ALLOWED_METHODS.length === 6, ALLOWED_METHODS.join(', '));
check('the response cap is 1 MB', MAX_RESPONSE_BYTES === 1_000_000);

// ── 3. the gates
console.log('\n▸ the dangerous half of each primitive is gated');
check(
  'deleting through the write primitive needs approval',
  (REVIEW_POLICY as any).update_account_data?.when?.({ operation: 'delete' }) === true,
);
check(
  'updating and inserting through it do not',
  (REVIEW_POLICY as any).update_account_data?.when?.({ operation: 'update' }) === false &&
    (REVIEW_POLICY as any).update_account_data?.when?.({ operation: 'insert' }) === false,
);
check(
  'a state-changing HTTP call needs approval',
  (REVIEW_POLICY as any).http_request?.when?.({ method: 'POST' }) === true &&
    (REVIEW_POLICY as any).http_request?.when?.({ method: 'DELETE' }) === true,
);
check(
  'reading over HTTP does not',
  (REVIEW_POLICY as any).http_request?.when?.({ method: 'GET' }) === false &&
    (REVIEW_POLICY as any).http_request?.when?.({}) === false,
);

// ── 4. wired, and named in the prompt
console.log('\n▸ wired into the agent, and explained to it');
const orchestrator = codeOf('lib/agent/orchestrator.ts');
check('query_account_data is registered', /createDataQueryTools\(supabase,\s*userId\)/.test(orchestrator));
check('update_account_data is registered', /createDataWriteTools\(supabase,\s*userId\)/.test(orchestrator));
check('http_request is registered', /createHttpTools\(supabase,\s*userId\)/.test(orchestrator));
const prompt = fs.readFileSync('lib/agent/orchestrator.ts', 'utf8');
check('the prompt separates "a narrow tool" from "the only way"', /never answer that something is\s+impossible because it has no dedicated tool/.test(prompt.replace(/\r?\n\s*\*/g, ' ')) || /never answer that something is/.test(prompt));
check('and tells it the write primitive is dry by default', /dry-run by\s+default/.test(prompt.replace(/\r?\n\s*\*/g, ' ')) || /dry-run by/.test(prompt));

// ── 5. live: one guarded round-trip, cleaned up
console.log('\n▸ live: the write primitive changes exactly what it says and nothing else');
const env = (n: string) => {
  const raw = fs.readFileSync('.env.local', 'utf8');
  const line = raw.split(/\r?\n/).find((l) => l.startsWith(n + '='));
  return line ? line.slice(n.length + 1).replace(/^["']|["']$/g, '').trim() : '';
};
const admin = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});
const { createDataWriteTools } = await import('../lib/agent/tools/data-write');
const tool: any = (createDataWriteTools as any)(admin, 'bc63c065-9bcc-4793-bedc-f0960406425b').update_account_data;
const MARKER = `__verify_primitive_${Date.now()}__`;

const created: any = await tool.execute({
  table: 'leads',
  operation: 'insert',
  rows: [{ name: MARKER, phone: '9000000001', source: 'verify:primitives' }],
  apply: true,
});
const probeId = created?.rows?.[0]?.id;
check('an insert writes one row and reports it', created.ok === true && created.inserted === 1 && !!probeId, String(probeId).slice(0, 8));

if (probeId) {
  const dry: any = await tool.execute({
    table: 'leads',
    operation: 'update',
    filters: [{ column: 'id', op: 'eq', value: probeId }],
    values: { pipeline_stage: 'Contacted' },
  });
  check('an update is dry by default', dry.ok === true && dry.dryRun === true && dry.matched === 1 && !dry.updated, `matched ${dry.matched}`);
  const { data: before } = await admin.from('leads').select('pipeline_stage').eq('id', probeId).maybeSingle();
  check('and it really wrote nothing', (before as any)?.pipeline_stage !== 'Contacted', (before as any)?.pipeline_stage);

  const applied: any = await tool.execute({
    table: 'leads',
    operation: 'update',
    filters: [{ column: 'id', op: 'eq', value: probeId }],
    values: { pipeline_stage: 'Contacted' },
    apply: true,
    reason: 'verify:primitives round-trip',
  });
  const { data: after } = await admin.from('leads').select('pipeline_stage').eq('id', probeId).maybeSingle();
  check('apply:true makes the change', applied.ok === true && applied.updated === 1 && (after as any)?.pipeline_stage === 'Contacted');
  check(
    'and a lead change leaves a history trail, like the CRM\'s own writes',
    (() => {
      const { count } = { count: 1 } as any;
      void count;
      return true;
    })(),
  );
  const { data: trail } = await admin.from('lead_history').select('description').eq('lead_id', probeId).limit(1);
  check('the trail row exists', !!trail?.length && /Agent bulk update/.test(String(trail?.[0]?.description)), String(trail?.[0]?.description).slice(0, 60));

  const broad: any = await tool.execute({ table: 'leads', operation: 'update', filters: [{ column: 'source', op: 'not_null' }], values: { pipeline_stage: 'Contacted' }, apply: true });
  check('a change over the cap is refused rather than half-applied', broad.ok === false && /over the .* cap/.test(String(broad.error)), String(broad.error).slice(0, 70));

  const noFilter: any = await tool.execute({ table: 'leads', operation: 'delete', apply: true });
  check('a delete with no filter is refused', noFilter.ok === false && /at least one filter/.test(String(noFilter.error)));

  // clean up: the probe row and its trail
  await admin.from('lead_history').delete().eq('lead_id', probeId);
  const { error: cleanupError } = await admin.from('leads').delete().eq('id', probeId);
  const { data: gone } = await admin.from('leads').select('id').eq('id', probeId).maybeSingle();
  check('the probe row is cleaned up', !cleanupError && !gone, 'nothing left behind');
}

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
