/**
 * Live proof that the scheduler works in production, without messaging anybody.
 *
 * It queues two steps for a lead that does not exist (so the safety gate must refuse it), one due
 * now and one due tomorrow, then ticks the real worker over HTTP and reads back what happened.
 * Nothing here can reach a customer: an unknown lead is refused by the opt-out gate.
 */
import '../lib/env-local';
import { createClient } from '@supabase/supabase-js';
import { enqueueFlowRun } from '../lib/flows/store';

const TENANT = process.argv[2] ?? 'bc63c065-9bcc-4793-bedc-f0960406425b';
const BASE = process.argv[3] ?? 'https://app.nobogent.com';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const secret = String(process.env.CRON_SECRET ?? '').trim();
const nonce = Date.now().toString(36);
const flowId = `probe-flow-${nonce}`;
const leadId = `probe-lead-does-not-exist-${nonce}`;

const health = async () => {
  const res = await fetch(`${BASE}/api/cron/flows`, { method: 'POST', headers: { 'x-cron-secret': secret } });
  return res.json() as Promise<any>;
};

console.log('1. health before:', JSON.stringify(await health()));

console.log('\n2. queue two steps (one due now, one due tomorrow)');
const first = await enqueueFlowRun(sb, TENANT, flowId, leadId, [
  { stepIndex: 0, kind: 'message', runAt: new Date(), payload: { probe: nonce } },
  { stepIndex: 1, kind: 'call', runAt: new Date(Date.now() + 86400000), payload: { probe: nonce } },
]);
console.log('   queued:', first.queued);

console.log('\n3. queue the same step again — the unique key must make it a no-op');
const second = await enqueueFlowRun(sb, TENANT, flowId, leadId, [
  { stepIndex: 0, kind: 'message', runAt: new Date(), payload: { probe: nonce } },
]);
console.log('   queued second time:', second.queued, second.queued === 0 ? '(correct: no duplicate)' : '(WRONG: duplicate created)');

console.log('\n4. unauthorised tick must be refused');
const unauth = await fetch(`${BASE}/api/cron/flows`, { method: 'GET' });
console.log('   status without secret:', unauth.status);

console.log('\n5. the real tick');
const tick = await fetch(`${BASE}/api/cron/flows`, { method: 'GET', headers: { 'x-cron-secret': secret } });
const tickBody: any = await tick.json();
const mine = (tickBody.results ?? []).find((r: any) => r.userId === TENANT);
console.log('   tick status:', tick.status);
console.log('   this owner:', mine ? JSON.stringify({ considered: mine.considered, executed: mine.executed.length, skipped: mine.skipped, deferred: mine.deferred.length }) : '(no work due)');

await new Promise((r) => setTimeout(r, 1500));

console.log('\n6. what the ledger says now');
const { data: rows } = await sb
  .from('flow_schedules')
  .select('step_index, kind, status, skip_reason, run_at')
  .eq('flow_id', flowId)
  .order('step_index');
for (const r of rows ?? []) {
  console.log(`   step ${(r as any).step_index} ${(r as any).kind}: ${(r as any).status}${(r as any).skip_reason ? ` (${(r as any).skip_reason})` : ''}`);
}
const dueNow = (rows ?? []).find((r: any) => r.step_index === 0);
const tomorrow = (rows ?? []).find((r: any) => r.step_index === 1);
console.log(`\n   the due step was refused for an unknown lead: ${dueNow?.status === 'skipped' && dueNow?.skip_reason === 'opted_out' ? 'YES' : 'NO'}`);
console.log(`   tomorrow's step is still pending: ${tomorrow?.status === 'pending' ? 'YES' : 'NO'}`);

const { data: runs } = await sb.from('flow_runs').select('step_index').eq('flow_id', flowId);
console.log(`   nothing was recorded as sent: ${(runs ?? []).length === 0 ? 'YES' : 'NO (' + (runs ?? []).length + ')'}`);

console.log('\n7. clean up the probe rows');
await sb.from('flow_schedules').delete().eq('flow_id', flowId);
await sb.from('flow_runs').delete().eq('flow_id', flowId);
const { data: after } = await sb.from('flow_schedules').select('id').eq('flow_id', flowId);
console.log('   rows left behind:', (after ?? []).length);
console.log('\n8. health after:', JSON.stringify(await health()));
