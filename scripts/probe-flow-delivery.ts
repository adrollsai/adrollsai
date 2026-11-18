/**
 * Does a flow actually reach a person now?
 *
 * This probe runs the real chain against the real database, in the order production runs it:
 *
 *   event  → ingress.fireFlowTrigger  (only a real webhook calls this in production)
 *          → flow_schedules rows
 *   clock  → runDueSteps + queueDueStep (the exact code /api/cron/flows runs)
 *          → agent_pending_deliveries at `pending_approval`
 *   human  → decideDelivery            (what the approvals screen calls)
 *          → dispatchDelivery          (what the cron calls afterwards)
 *
 * It SENDS NOTHING. The delivery it approves is free-form text with the WhatsApp window shut, so
 * the honest outcome is `blocked` with the 24-hour reason — which proves the dispatcher ran, applied
 * its rules, and told the truth. Sending a real message is a decision for the owner, not a probe.
 *
 * Everything it creates is deleted at the end, including on failure.
 *
 *   npm run probe:flow-delivery
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';

function envFromLocal(): Record<string, string> {
  const raw = fs.readFileSync(path.resolve('.env.local'), 'utf8');
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match) out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...envFromLocal(), ...process.env } as Record<string, string>;
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const OWNER = 'bc63c065-9bcc-4793-bedc-f0960406425b';
let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const cleanup: (() => Promise<void>)[] = [];
const runId = Date.now().toString(36);

async function main() {
  const { fireFlowTrigger } = await import('../lib/flows/ingress');
  const { runDueSteps } = await import('../lib/flows/scheduling');
  const { scheduledStore } = await import('../lib/flows/store');
  const { queueDueStep } = await import('../lib/flows/queue-step');
  const { decideDelivery, dispatchDelivery, listDeliveries, mapDelivery } = await import('../lib/flows/delivery');

  // ── a probe lead to attach the flow to ──────────────────────────────────
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .insert({
      user_id: OWNER,
      name: `[probe ${runId}] flow delivery`,
      phone: '918288835235',
      source: 'flow_probe',
      status: 'active',
      pipeline_stage: 'New',
    })
    .select('id')
    .single();
  if (leadErr || !lead?.id) throw new Error(`could not create the probe lead: ${leadErr?.message}`);
  const leadId = String(lead.id);
  cleanup.push(async () => {
    await supabase.from('agent_pending_deliveries').delete().eq('lead_id', leadId);
    await supabase.from('flow_schedules').delete().eq('lead_id', leadId);
    await supabase.from('flow_runs').delete().eq('lead_id', leadId);
    await supabase.from('lead_history').delete().eq('lead_id', leadId);
    await supabase.from('leads').delete().eq('id', leadId);
  });

  // ── a real flow row that listens for an inbound message ─────────────────
  const flowDescription = JSON.stringify({
    name: `[probe ${runId}] inbound reply`,
    isActive: true,
    trigger: { type: 'trigger_whatsapp_inbound', keywords: ['probe'], config: {} },
    nodes: [
      { id: 'trigger', type: 'triggerNode', data: { triggerType: 'trigger_whatsapp_inbound' } },
      { id: 'm1', type: 'whatsappMessageNode', data: { message: 'Thanks for your message — how can we help?' } },
      { id: 'h1', type: 'action_ai_call_transfer', data: { note: 'A human should follow this one up.' } },
    ],
  });
  const { data: flow, error: flowErr } = await supabase
    .from('automations')
    .insert({ user_id: OWNER, title: `Flow: [probe ${runId}] inbound reply`, description: flowDescription, is_active: true })
    .select('id')
    .single();
  if (flowErr || !flow?.id) throw new Error(`could not create the probe flow: ${flowErr?.message}`);
  const flowId = String(flow.id);
  cleanup.push(async () => {
    await supabase.from('flow_schedules').delete().eq('flow_id', flowId);
    await supabase.from('flow_runs').delete().eq('flow_id', flowId);
    await supabase.from('automations').delete().eq('id', flowId);
  });

  // ── 1. the event ───────────────────────────────────────────────────────
  console.log('\n1. an inbound message fires the flow that listens for it');
  const notThisOne = await fireFlowTrigger(supabase, {
    userId: OWNER,
    trigger: 'trigger_crm_lead',
    leadId,
    text: 'probe lead created',
    runKey: `probe-wrong:${runId}`,
  });
  check(
    'a different event does NOT start an inbound flow',
    notThisOne.started.every((s) => s.flowId !== flowId),
    JSON.stringify(notThisOne.started.map((s) => s.title))
  );

  const fired = await fireFlowTrigger(supabase, {
    userId: OWNER,
    trigger: 'trigger_whatsapp_inbound',
    leadId,
    text: 'hello, probe here',
    runKey: `probe:${runId}`,
  });
  const mine = fired.started.find((s) => s.flowId === flowId);
  check('the inbound event starts it', !!mine, JSON.stringify(fired.skipped.slice(0, 3)));
  check('and it writes every step into the ledger', (mine?.queued ?? 0) === 2, String(mine?.queued));

  const { data: scheduleRows } = await supabase
    .from('flow_schedules')
    .select('id, step_index, kind, run_key, status, payload')
    .eq('flow_id', flowId)
    .order('step_index', { ascending: true });
  check('two scheduled rows exist, in order', (scheduleRows ?? []).length === 2, String((scheduleRows ?? []).length));
  check(
    'the run key is the event, not "once"',
    (scheduleRows ?? []).every((r: any) => r.run_key === `probe:${runId}`),
    JSON.stringify((scheduleRows ?? []).map((r: any) => r.run_key))
  );
  check('the handoff step kept its internal instruction', String((scheduleRows ?? [])[1]?.payload?.internal?.kind) === 'note');

  // A replayed webhook must not queue the same run twice.
  const replay = await fireFlowTrigger(supabase, {
    userId: OWNER,
    trigger: 'trigger_whatsapp_inbound',
    leadId,
    text: 'hello, probe here',
    runKey: `probe:${runId}`,
  });
  const replayMine = replay.started.find((s) => s.flowId === flowId);
  check('the same event replayed queues nothing new', replayMine?.queued === 0 && !!replayMine?.note, JSON.stringify(replayMine));

  // ── 2. the clock ───────────────────────────────────────────────────────
  console.log('\n2. the clock turns due steps into approvals (and CRM-only work)');
  const store = scheduledStore(supabase, OWNER);
  // The steps were scheduled at the next allowed hour (quiet hours push a 22:00 message to 09:00),
  // so the clock is simulated at 10:00 tomorrow rather than at whatever time this probe happens to
  // run. That is the same clock the cron uses, with `now` moved forward.
  const clock = new Date();
  clock.setDate(clock.getDate() + 1);
  clock.setHours(10, 0, 0, 0);
  const report = await runDueSteps(store, clock, {
    quietHours: { startHour: 0, endHour: 0 },
    limit: 50,
    execute: async (step) => {
      if (step.leadId !== leadId) return; // other tenants' rows are somebody else's business
      await queueDueStep(supabase, { userId: OWNER, step });
    },
  });
  const ours = report.executed.filter((id) => id);
  check('the due steps were executed', ours.length >= 1, JSON.stringify(report.skipped.slice(0, 4)));

  const { data: deliveries } = await supabase
    .from('agent_pending_deliveries')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: true });
  const rows = (deliveries ?? []).map(mapDelivery);
  const pending = rows.filter((r) => r.status === 'pending_approval');
  check('the message step became ONE approval row', pending.length === 1, JSON.stringify(rows.map((r) => r.status)));
  check('the approval row carries the real text', /how can we help/i.test(pending[0]?.body ?? ''), pending[0]?.body ?? '');
  check('the approval row carries the real number', pending[0]?.toPhone === '918288835235', pending[0]?.toPhone ?? '');
  check('it records which trigger queued it', pending[0]?.trigger === 'trigger_whatsapp_inbound');

  const { data: history } = await supabase.from('lead_history').select('description').eq('lead_id', leadId);
  check(
    'the handoff was applied to the CRM, with no approval needed',
    (history ?? []).some((h: any) => /human should follow/i.test(String(h.description))),
    JSON.stringify((history ?? []).map((h: any) => h.description))
  );
  check(
    'and the handoff did NOT become a message to the customer',
    rows.every((r) => !/human should follow/i.test(r.body ?? '')),
    JSON.stringify(rows.map((r) => r.body))
  );

  // ── 3. nothing sends without a human ───────────────────────────────────
  console.log('\n3. nothing is sent until a human approves it');
  const { dispatchApprovedDeliveries } = await import('../lib/flows/delivery');
  const before = await dispatchApprovedDeliveries(supabase, { userId: OWNER });
  check('nothing approved means nothing dispatched', before.considered === 0, JSON.stringify(before.outcomes));
  const stillPending = await listDeliveries(supabase, OWNER, { status: ['pending_approval'], limit: 200 });
  check(
    'the pending row is still pending after a dispatch pass',
    stillPending.some((d) => d.id === pending[0]?.id),
    String(stillPending.length)
  );

  // ── 4. a human decides, and the dispatcher tells the truth ─────────────
  console.log('\n4. approving is a decision; sending is a separate, honest step');
  const decided = await decideDelivery(supabase, { userId: OWNER, deliveryId: pending[0]!.id, decision: 'approve' });
  check('the approval is recorded', decided.ok && decided.status === 'approved', decided.error);
  const again = await decideDelivery(supabase, { userId: OWNER, deliveryId: pending[0]!.id, decision: 'approve' });
  check('and cannot be decided twice', again.ok === false && /already approved/.test(again.error ?? ''), again.error);

  const outcome = await dispatchDelivery(supabase, decided.delivery!);
  check('the dispatcher ran and reported a real outcome', ['delivered', 'blocked', 'failed'].includes(outcome.status), outcome.detail);
  check(
    'free text with the window shut is BLOCKED with the 24-hour reason, not attempted',
    outcome.status === 'blocked' && /24 hours/i.test(outcome.detail),
    `${outcome.status}: ${outcome.detail}`
  );
  const { data: afterRow } = await supabase.from('agent_pending_deliveries').select('status, error_message').eq('id', pending[0]!.id).maybeSingle();
  check('and the refusal is on the record, not in a log nobody reads', (afterRow as any)?.status === 'blocked' && !!(afterRow as any)?.error_message, JSON.stringify(afterRow));

  const { data: runs } = await supabase.from('flow_runs').select('step_index, run_key').eq('flow_id', flowId);
  check('the run history is written so a retry cannot resend', (runs ?? []).length >= 1, JSON.stringify(runs));
}

async function run() {
  try {
    await main();
  } catch (error: any) {
    failed++;
    console.log(`  FAIL probe crashed: ${String(error?.message || error)}`);
  } finally {
    for (const undo of cleanup.reverse()) {
      try {
        await undo();
      } catch (error: any) {
        console.warn(`  cleanup warning: ${String(error?.message || error)}`);
      }
    }
    console.log(`\n${'='.repeat(64)}`);
    console.log(`${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  }
}

void run();
