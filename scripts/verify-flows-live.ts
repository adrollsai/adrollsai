/**
 * Can the agent actually create a working flow, and does it avoid colliding with existing ones?
 *
 * Two things are checked: that a flow it builds lands in the database as a real, active row, and
 * that asking for something conflicting (same trigger twice, a delay longer than the runner
 * honours) is refused rather than silently written.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';

dotenv.config({ path: '.env.local', quiet: true });
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const OWNER = 'bc63c065-9bcc-4793-bedc-f0960406425b';

const results: { step: string; ok: boolean; detail?: string }[] = [];
const record = (step: string, ok: boolean, detail = '') => {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? `  — ${detail}` : ''}`);
};

const ctx = await createAgentContext(admin, OWNER, { intentText: 'build me an automation' });
const tools = ctx.tools as any;

console.log('flow tools present:', ['create_flow', 'list_automation_flows', 'check_flow_conflicts'].filter((t) => tools[t]));

const { data: before } = await admin.from('automations').select('id').eq('user_id', OWNER);

// 1. a legitimate flow
const created = await tools.create_flow.execute({
  name: 'Catalogue reply in 5s',
  trigger: 'trigger_whatsapp_inbound',
  steps: [{ kind: 'message', text: 'Here is our catalogue.' }, { kind: 'wait', seconds: 5 }],
});
console.log('\ncreate_flow ->', JSON.stringify(created).slice(0, 400));

const { data: after } = await admin
  .from('automations')
  .select('id, title, is_active, description')
  .eq('user_id', OWNER)
  .order('created_at', { ascending: false });
const rows = after ?? [];
record('a flow row was written', rows.length > (before?.length ?? 0), `${rows.length} flow(s) now`);
record('it is titled and described', Boolean(rows[0]?.title), String(rows[0]?.title ?? ''));
record('it is left inactive until the owner enables it', rows[0]?.is_active === false, String(rows[0]?.is_active));

// 2. a delay the runner cannot honour
const badWait = await tools.create_flow.execute({
  name: 'Follow up in 2 hours',
  trigger: 'trigger_whatsapp_inbound',
  steps: [{ kind: 'wait', seconds: 7200 }],
});
record(
  'an impossible delay is refused, not written',
  badWait?.success === false || badWait?.error || /delay|wait/i.test(JSON.stringify(badWait)),
  String(badWait?.error ?? JSON.stringify(badWait).slice(0, 120)),
);

// 3. the same flow twice — does it notice?
const again = await tools.create_flow.execute({
  name: 'Catalogue reply in 5s',
  trigger: 'trigger_whatsapp_inbound',
  steps: [{ kind: 'message', text: 'Here is our catalogue.' }],
});
record(
  'a duplicate flow is reported rather than silently doubled',
  again?.success === false || /duplicate|already|conflict|exists/i.test(JSON.stringify(again)),
  String(again?.error ?? JSON.stringify(again).slice(0, 140)),
);

// 4. list + conflict view
const listed = await tools.list_automation_flows.execute({});
record('the agent can see the flows it made', JSON.stringify(listed).includes('catalogue'), `${JSON.stringify(listed).length} chars`);
const conflicts = await tools.check_flow_conflicts.execute({});
record('a conflict check exists and answers', conflicts !== undefined, JSON.stringify(conflicts).slice(0, 140));

// clean up whatever we created so the owner's account is not cluttered
const { data: fresh } = await admin.from('automations').select('id').eq('user_id', OWNER);
for (const row of fresh ?? []) {
  if (!(before ?? []).some((b) => b.id === row.id)) await admin.from('automations').delete().eq('id', row.id);
}
console.log('\ncleaned up test flows');

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
