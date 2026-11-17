/**
 * Full live proof of the flow chain: create a flow, start it for a lead, watch the clock, clean up.
 * The lead does not exist, so the safety gate must refuse to send anything.
 */
import '../lib/env-local';
import { createClient } from '@supabase/supabase-js';

const TENANT = 'bc63c065-9bcc-4793-bedc-f0960406425b';
const BASE = 'https://app.pipixel.io';
const secret = String(process.env.CRON_SECRET ?? '').trim();
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const nonce = Date.now().toString(36);

const description = 'Flow: probe ' + nonce + '\n' + JSON.stringify({
  name: 'probe ' + nonce,
  isActive: false,
  trigger: { type: 'trigger_meta_ad', config: {} },
  nodes: [
    { type: 'triggerNode', data: {} },
    { type: 'whatsappMessageNode', data: { message: 'probe message ' + nonce, templateName: null } },
    { type: 'delayNode', data: { seconds: 600 } },
    { type: 'aiCallNode', data: { description: 'qualify' } },
  ],
});

const { data: flow, error } = await sb.from('automations').insert({
  user_id: TENANT, title: 'Flow: probe ' + nonce, description, is_active: false, stats: JSON.stringify({ runs: 0, completed: 0 }),
}).select('id').single();
if (error) { console.log('could not create probe flow:', error.message); process.exit(1); }
console.log('1. probe flow created:', flow.id.slice(0, 8), '(paused)');

const start = await fetch(`${BASE}/api/flows/start`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret },
  body: JSON.stringify({ flowId: flow.id, leadId: 'probe-lead-' + nonce, userId: TENANT }),
});
const started: any = await start.json();
console.log('2. start (paused flow):', start.status, JSON.stringify({ queued: started.queued, blockers: started.blockers }));

await sb.from('automations').update({ is_active: true }).eq('id', flow.id);
const start2 = await fetch(`${BASE}/api/flows/start`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret },
  body: JSON.stringify({ flowId: flow.id, leadId: 'probe-lead-' + nonce, userId: TENANT }),
});
const started2: any = await start2.json();
console.log('3. start (active flow):', start2.status, JSON.stringify({ ok: started2.ok, queued: started2.queued, firstRunAt: started2.firstRunAt, blockers: started2.blockers }));

const start3 = await fetch(`${BASE}/api/flows/start`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret },
  body: JSON.stringify({ flowId: flow.id, leadId: 'probe-lead-' + nonce, userId: TENANT }),
});
const started3: any = await start3.json();
console.log('4. start again (idempotent):', start3.status, JSON.stringify({ queued: started3.queued }));

const { data: rows } = await sb.from('flow_schedules').select('step_index, kind, status, run_at, payload').eq('flow_id', flow.id).order('step_index');
for (const r of rows ?? []) {
  const p: any = (r as any).payload || {};
  console.log(`5. ledger step ${(r as any).step_index} ${(r as any).kind} at ${(r as any).run_at} status=${(r as any).status} text="${String(p.text || "").slice(0, 26)}"`);
}

const tick = await fetch(`${BASE}/api/cron/flows`, { headers: { 'x-cron-secret': secret } });
const tickBody: any = await tick.json();
const mine = (tickBody.results ?? []).find((r: any) => r.userId === TENANT);
console.log('6. tick:', tick.status, mine ? JSON.stringify({ considered: mine.considered, executed: mine.executed.length, skipped: mine.skipped }) : '(no work)');

const { data: after } = await sb.from('flow_schedules').select('step_index, status, skip_reason').eq('flow_id', flow.id).order('step_index');
for (const r of after ?? []) console.log(`7. after   step ${(r as any).step_index}: ${(r as any).status}${(r as any).skip_reason ? " (" + (r as any).skip_reason + ")" : ""}`);
const { data: runs } = await sb.from('flow_runs').select('id').eq('flow_id', flow.id);
console.log('8. recorded as sent:', (runs ?? []).length, '(must be 0)');

await sb.from('flow_schedules').delete().eq('flow_id', flow.id);
await sb.from('flow_runs').delete().eq('flow_id', flow.id);
await sb.from('automations').delete().eq('id', flow.id);
const { data: left } = await sb.from('flow_schedules').select('id').eq('flow_id', flow.id);
console.log('9. cleaned up, rows left:', (left ?? []).length);
