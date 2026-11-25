/**
 * ACCEPT: a flow with a condition sends one lead down each branch, in the real database.
 *
 * The gate proves the logic with fakes. This proves the feature: a flow built in the editor's own
 * vocabulary, saved through the real translator, started for two leads of different shapes, and then
 * run through the real scheduler — with the ledger rows inspected afterwards to show that each lead
 * had exactly one side run and the other side retired, by name.
 *
 * It runs on the THROWAWAY account and deletes everything it creates (flow, leads, schedules, runs,
 * queued approvals), whether it passes or fails.
 *
 *   npm run accept-flow-branching
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

import { translateCanvasFlow } from '../lib/flows/canvas-translation';
import { startFlowRun } from '../lib/flows/start';
import { runDueSteps } from '../lib/flows/scheduling';
import { scheduledStore, quietHoursFor } from '../lib/flows/store';
import { queueDueStep } from '../lib/flows/queue-step';

const TEST_USER = process.env.NOBO_TEST_ACCOUNT || 'b63bd63a-e7cc-440c-8d91-1b435f6edf21';
const MARKER = `branch-accept-${Date.now()}`;

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  -- ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  -- ${detail}` : ''}`);
  }
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const created = { flowId: '', leadIds: [] as string[] };

async function cleanup() {
  if (created.flowId) {
    await supabase.from('agent_pending_deliveries').delete().eq('flow_id', created.flowId);
    await supabase.from('flow_runs').delete().eq('flow_id', created.flowId);
    await supabase.from('flow_schedules').delete().eq('flow_id', created.flowId);
    await supabase.from('automations').delete().eq('id', created.flowId);
  }
  for (const leadId of created.leadIds) {
    await supabase.from('lead_history').delete().eq('lead_id', leadId);
    await supabase.from('leads').delete().eq('id', leadId);
  }
  const residue = await supabase.from('flow_schedules').select('id').eq('user_id', TEST_USER).eq('flow_id', created.flowId || 'none');
  if ((residue.data ?? []).length) console.log(`  note: ${residue.data!.length} schedule row(s) remain`);
}

async function main() {
  console.log(`throwaway account: ${TEST_USER}`);
  console.log(`marker           : ${MARKER}\n`);

  // ── the flow, built the way the editor builds it ─────────────────────────
  const canvas = {
    trigger: { type: 'crm_lead', label: 'A lead arrives' },
    nodes: [
      {
        id: 'cond_stage',
        type: 'action_condition',
        title: 'Is this a brand-new lead?',
        branch: 'main',
        config: {
          evaluationType: 'crm_attribute',
          field: 'pipeline_stage',
          operator: '==',
          value: 'New Lead',
          branchTrueLabel: 'New',
          branchFalseLabel: 'Already in conversation',
        },
      },
      {
        id: 'msg_new',
        type: 'action_whatsapp_msg',
        title: 'Welcome the new lead (TRUE branch)',
        branch: 'true',
        config: { message: 'Hi {{lead.name}}, {{business_name}} here — thanks for reaching out. When suits a quick call?' },
      },
      {
        id: 'msg_known',
        type: 'action_whatsapp_msg',
        title: 'Nudge the existing lead (FALSE branch)',
        branch: 'false',
        config: { message: 'Hi {{lead.name}}, following up on our last chat — anything you need from us?' },
      },
    ],
  };

  const translated = translateCanvasFlow(canvas);
  check('the flow translates with no blocking problems', translated.problems.length === 0, JSON.stringify(translated.problems));
  const storedNodes = translated.nodes;

  const { data: flow, error: flowErr } = await supabase
    .from('automations')
    .insert({
      user_id: TEST_USER,
      title: `${MARKER} — branch accept`,
      description: JSON.stringify({ name: MARKER, trigger: translated.trigger, nodes: storedNodes }),
      icon_name: 'git-branch',
      is_active: true,
      stats: {},
    })
    .select('id')
    .single();
  if (flowErr) throw new Error(`could not create the flow: ${flowErr.message}`);
  created.flowId = String(flow.id);
  check('the flow was saved as an automation', Boolean(created.flowId), created.flowId.slice(0, 8));

  // ── two leads of different shapes ────────────────────────────────────────
  const makeLead = async (name: string, stage: string) => {
    const { data, error } = await supabase
      .from('leads')
      .insert({
        user_id: TEST_USER,
        name,
        phone: `+9199000${Math.floor(Math.random() * 90000) + 10000}`,
        pipeline_stage: stage,
        source: MARKER,
        status: 'new',
      })
      .select('id')
      .single();
    if (error) throw new Error(`could not create a lead: ${error.message}`);
    created.leadIds.push(String(data.id));
    return String(data.id);
  };

  const newLead = await makeLead(`${MARKER} new`, 'New Lead');
  const knownLead = await makeLead(`${MARKER} known`, 'Contacted');
  check('two leads of different shapes exist', Boolean(newLead && knownLead));

  // ── start a run for each ─────────────────────────────────────────────────
  const description = JSON.stringify({ name: MARKER, trigger: translated.trigger, nodes: storedNodes });
  for (const [label, leadId] of [['new', newLead], ['known', knownLead]] as const) {
    const started = await startFlowRun(supabase, {
      userId: TEST_USER,
      flowId: created.flowId,
      leadId,
      description,
      runKey: `${MARKER}-${label}`,
      triggerType: 'trigger_crm_lead',
    });
    check(`${label}: the run started`, started.ok, started.blockers?.join('; ') || `${started.queued} step(s) queued`);
  }

  const { data: rows } = await supabase
    .from('flow_schedules')
    .select('id, lead_id, step_index, kind, status, run_at, payload')
    .eq('flow_id', created.flowId)
    .order('step_index', { ascending: true });
  const schedules = rows ?? [];
  check('both branches reached flow_schedules', schedules.length >= 4, `${schedules.length} rows for 2 leads`);

  const gatesOnRows = schedules.filter((r: any) => Array.isArray(r.payload?.gates) && r.payload.gates.length);
  check('each row carries the branch predicate it is guarded by', gatesOnRows.length === schedules.length, `${gatesOnRows.length}/${schedules.length}`);
  const sidesFor = (leadId: string) =>
    schedules
      .filter((r: any) => r.lead_id === leadId)
      .map((r: any) => `${r.step_index}:${r.payload?.gates?.[0]?.want === true ? 'true' : r.payload?.gates?.[0]?.want === false ? 'false' : 'ungated'}`);
  check('the new lead has a step on each side, in the ledger', sidesFor(newLead).length === 2, sidesFor(newLead).join(' '));
  check('the known lead has a step on each side, in the ledger', sidesFor(knownLead).length === 2, sidesFor(knownLead).join(' '));

  // ── run the clock ────────────────────────────────────────────────────────
  // Push every row to "due" so the next tick has work without waiting for quiet hours to pass.
  await supabase
    .from('flow_schedules')
    .update({ run_at: new Date(Date.now() - 60_000).toISOString() })
    .eq('flow_id', created.flowId);

  const store = scheduledStore(supabase, TEST_USER);
  const quiet = { ...(await quietHoursFor(supabase, TEST_USER)), startHour: 0, endHour: 0 };
  const report = await runDueSteps(store, new Date(), {
    quietHours: quiet,
    limit: 25,
    execute: async (step) => {
      await queueDueStep(supabase, { userId: TEST_USER, step });
    },
  });

  console.log(`\n  tick: ${report.executed.length} executed, ${report.skipped.length} skipped`);
  for (const skipped of report.skipped) console.log(`    skipped ${skipped.stepId.slice(0, 8)}: ${skipped.reason}`);

  const { data: after } = await supabase
    .from('flow_schedules')
    .select('id, lead_id, step_index, status, skip_reason, payload')
    .eq('flow_id', created.flowId);
  const final = after ?? [];
  const statusFor = (leadId: string, want: boolean) =>
    final.find((r: any) => r.lead_id === leadId && r.payload?.gates?.[0]?.want === want);

  check(
    'the new lead RAN the true branch',
    statusFor(newLead, true)?.status === 'done',
    `${statusFor(newLead, true)?.status} / ${statusFor(newLead, true)?.skip_reason ?? '-'}`
  );
  check(
    'the new lead SKIPPED the false branch, by name',
    statusFor(newLead, false)?.status === 'skipped' && statusFor(newLead, false)?.skip_reason === 'branch_not_taken',
    `${statusFor(newLead, false)?.status} / ${statusFor(newLead, false)?.skip_reason ?? '-'}`
  );
  check(
    'the known lead RAN the false branch',
    statusFor(knownLead, false)?.status === 'done',
    `${statusFor(knownLead, false)?.status} / ${statusFor(knownLead, false)?.skip_reason ?? '-'}`
  );
  check(
    'the known lead SKIPPED the true branch, by name',
    statusFor(knownLead, true)?.status === 'skipped' && statusFor(knownLead, true)?.skip_reason === 'branch_not_taken',
    `${statusFor(knownLead, true)?.status} / ${statusFor(knownLead, true)?.skip_reason ?? '-'}`
  );

  // ── the messages that DID run went to the approval queue, not to a customer ──
  const { data: deliveries } = await supabase
    .from('agent_pending_deliveries')
    .select('id, lead_id, status, body')
    .eq('flow_id', created.flowId);
  check(
    'exactly one message per lead is waiting for a human, and nothing was sent',
    (deliveries ?? []).length === 2 && (deliveries ?? []).every((d: any) => d.status === 'pending_approval'),
    JSON.stringify((deliveries ?? []).map((d: any) => d.status))
  );
  const bodies = (deliveries ?? []).map((d: any) => String(d.body));
  check('the lead on each side got its own copy', bodies.some((b) => /thanks for reaching out/i.test(b)) && bodies.some((b) => /following up on our last chat/i.test(b)));
}

try {
  await main();
} catch (err: any) {
  fail++;
  console.log(`FAIL  the script completed -- ${err?.message || err}`);
} finally {
  await cleanup();
  console.log(`\ncleaned up flow ${created.flowId.slice(0, 8) || '(none)'} and ${created.leadIds.length} lead(s)`);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
