/**
 * End-to-end acceptance for a booking sequence, against the real database.
 *
 * Proves the four things that have to be true for "send this 30 minutes before the meeting" to be
 * something we can promise:
 *   1. booking a meeting schedules the steps at the right absolute times;
 *   2. when a step's moment arrives, it is queued for approval carrying the right template
 *      (nothing is sent from here — the approval queue is the safety boundary);
 *   3. RESCHEDULING cancels the old steps and re-plans against the new time;
 *   4. CANCELLING the appointment drops them entirely.
 *
 * Everything it creates is deleted at the end, including the lead and the flow.
 *
 *   npx tsx scripts/accept-sequence.ts
 */
import { createClient } from '@supabase/supabase-js';
import { buildFlow } from '../lib/agent/tools/flows';
import { onBookingChanged } from '../lib/flows/booking-trigger';
import { fireFlowTrigger } from '../lib/flows/ingress';
import { queueDueStep } from '../lib/flows/queue-step';
import { SCHEDULES, RUNS } from '../lib/flows/store';

const TEST_USER = 'b63bd63a-e7cc-440c-8d91-1b435f6edf21'; // "Nobogent Test" — a throwaway account
const FLOW_NAME = 'Sequence acceptance (delete me)';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
};

const minutesFrom = (base: number, iso: string) => Math.round((new Date(iso).getTime() - base) / 60000);

(async () => {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  // ── fixtures ────────────────────────────────────────────────────────────────────────────────
  const { data: lead, error: leadErr } = await db
    .from('leads')
    .insert({
      user_id: TEST_USER,
      name: 'Sequence acceptance lead',
      phone: '919999000001',
      status: 'new',
      campaign_id: 'accept_campaign_1',
    })
    .select('id')
    .single();
  if (leadErr) throw new Error(`lead: ${leadErr.message}`);

  const flow = buildFlow({
    name: FLOW_NAME,
    trigger: 'trigger_booking_created',
    isActive: true,
    steps: [
      { kind: 'template', templateName: 'acceptances_template_30', beforeEventMinutes: 30 },
      { kind: 'template', templateName: 'acceptances_template_10', beforeEventMinutes: 10 },
    ],
  });

  const { data: automation, error: flowErr } = await db
    .from('automations')
    .insert({
      user_id: TEST_USER,
      title: flow.title,
      description: flow.description,
      is_active: true,
    })
    .select('id')
    .single();
  if (flowErr) throw new Error(`automation: ${flowErr.message}`);

  const clean = async () => {
    await db.from(SCHEDULES).delete().eq('flow_id', automation.id);
    await db.from(RUNS).delete().eq('flow_id', automation.id);
    await db.from('agent_pending_deliveries').delete().eq('flow_id', automation.id);
    await db.from('automations').delete().eq('id', automation.id);
    await db.from('leads').delete().eq('id', lead.id);
  };

  try {
    // ── 1. a booking schedules the reminders ──────────────────────────────────────────────────
    const startedAt = Date.now();
    const meeting = new Date(startedAt + 40 * 60 * 1000);

    const first = await onBookingChanged(db, {
      userId: TEST_USER,
      leadId: lead.id,
      bookedTime: meeting,
      previousBookedTime: null,
    });
    check('booking a meeting starts the sequence', first.action === 'started', `${first.action}: ${first.notes.join(' | ')}`);

    const { data: rows } = await db
      .from(SCHEDULES)
      .select('id, step_index, kind, run_at, status, payload')
      .eq('flow_id', automation.id)
      .order('run_at');
    const planned = rows ?? [];
    check('two reminders are on the ledger', planned.length === 2, `${planned.length}`);
    check('the first is 30 min before the meeting', planned[0] && Math.abs(minutesFrom(meeting.getTime(), planned[0].run_at) + 30) <= 1, planned[0] ? `${minutesFrom(meeting.getTime(), planned[0].run_at)} min` : 'missing');
    check('the second is 10 min before the meeting', planned[1] && Math.abs(minutesFrom(meeting.getTime(), planned[1].run_at) + 10) <= 1, planned[1] ? `${minutesFrom(meeting.getTime(), planned[1].run_at)} min` : 'missing');
    check('each carries its own template', planned[0]?.payload?.templateName === 'acceptances_template_30' && planned[1]?.payload?.templateName === 'acceptances_template_10', `${planned[0]?.payload?.templateName} / ${planned[1]?.payload?.templateName}`);
    check('all of them are pending, not sent', planned.every((row) => row.status === 'pending'));

    // ── 2. the moment arrives → queued for a human, carrying the template ────────────────────
    await db.from(SCHEDULES).update({ run_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', planned[0].id);
    const outcome = await queueDueStep(db, {
      userId: TEST_USER,
      step: {
        id: planned[0].id,
        flowId: automation.id,
        leadId: lead.id,
        stepIndex: planned[0].step_index,
        kind: 'message',
        runAt: planned[0].run_at,
        status: 'pending',
        attempts: 0,
      },
    });
    check('the due step becomes an approval, not a send', outcome.kind === 'queued_for_approval', outcome.detail);

    const { data: deliveries } = await db
      .from('agent_pending_deliveries')
      .select('id, channel, template_name, status, to_phone')
      .eq('flow_id', automation.id);
    check('it is waiting for approval', deliveries?.[0]?.status === 'pending_approval', String(deliveries?.[0]?.status));
    check('and it names the template it will send', deliveries?.[0]?.template_name === 'acceptances_template_30', String(deliveries?.[0]?.template_name));
    check('to the lead\u2019s own number', String(deliveries?.[0]?.to_phone ?? '').includes('9999000001'), String(deliveries?.[0]?.to_phone));

    // ── 3. rescheduling re-plans against the new time ────────────────────────────────────────
    const movedTo = new Date(Date.now() + 5 * 60 * 60 * 1000);
    const replanned = await onBookingChanged(db, {
      userId: TEST_USER,
      leadId: lead.id,
      bookedTime: movedTo,
      previousBookedTime: meeting,
    });
    check('a reschedule is recognised as a replan', replanned.action === 'replanned', replanned.action);
    check('the old steps are cancelled', replanned.cancelledSteps >= 1, `${replanned.cancelledSteps} cancelled`);

    const { data: afterMove } = await db
      .from(SCHEDULES)
      .select('id, run_at, status, skip_reason')
      .eq('flow_id', automation.id)
      .eq('status', 'pending')
      .order('run_at');
    check('and the new steps sit against the new meeting', (afterMove ?? []).length === 2, `${(afterMove ?? []).length} pending`);
    check(
      'the nearest one is now ~4.5 hours out, not minutes',
      afterMove?.[0] ? Math.abs(minutesFrom(Date.now(), afterMove[0].run_at) - 270) <= 2 : false,
      afterMove?.[0] ? `${minutesFrom(Date.now(), afterMove[0].run_at)} min` : 'missing'
    );

    // ── 4. cancelling drops them entirely ───────────────────────────────────────────────────
    const cancelled = await onBookingChanged(db, {
      userId: TEST_USER,
      leadId: lead.id,
      bookedTime: null,
      previousBookedTime: movedTo,
    });
    check('cancelling the appointment is reported as a cancellation', cancelled.action === 'cancelled', cancelled.action);

    const { data: afterCancel } = await db
      .from(SCHEDULES)
      .select('id, status, skip_reason')
      .eq('flow_id', automation.id)
      .eq('status', 'pending');
    check('nothing is left waiting to send', (afterCancel ?? []).length === 0, `${(afterCancel ?? []).length} still pending`);

    const { data: skippedRows } = await db
      .from(SCHEDULES)
      .select('skip_reason')
      .eq('flow_id', automation.id)
      .eq('skip_reason', 'booking_cancelled');
    check('and the ledger says why', (skippedRows ?? []).length >= 2, `${(skippedRows ?? []).length} marked booking_cancelled`);

    // ── 5. the other half: a lead from ONE campaign, now and again in two days ───────────────
    const campaignFlow = buildFlow({
      name: `${FLOW_NAME} — campaign`,
      trigger: 'trigger_meta_ad',
      campaignId: 'accept_campaign_1',
      isActive: true,
      steps: [
        { kind: 'template', templateName: 'acceptances_welcome' },
        { kind: 'template', templateName: 'acceptances_brochure', delayMinutes: 2 * 24 * 60 },
      ],
    });
    const { data: campaignAutomation, error: campaignErr } = await db
      .from('automations')
      .insert({ user_id: TEST_USER, title: campaignFlow.title, description: campaignFlow.description, is_active: true })
      .select('id')
      .single();
    if (campaignErr) throw new Error(`campaign automation: ${campaignErr.message}`);

    try {
      // The event deliberately carries NO campaign: the lead does, and ingress has to find it —
      // otherwise every webhook caller would need editing to support campaign-scoped sequences.
      const fireTime = new Date();
      const firedLead = await fireFlowTrigger(db, {
        userId: TEST_USER,
        trigger: 'trigger_meta_ad',
        leadId: lead.id,
        now: fireTime,
      });
      check('the campaign sequence fires for a lead from that campaign', firedLead.started.some((s) => s.title === campaignFlow.title), firedLead.started.map((s) => s.title).join(', ') || firedLead.skipped.map((s) => s.why).join(' | '));

      const { data: campaignRows } = await db
        .from(SCHEDULES)
        .select('run_at, payload, status')
        .eq('flow_id', campaignAutomation.id)
        .order('run_at');
      const rows = campaignRows ?? [];
      check('two sends are scheduled', rows.length === 2, `${rows.length}`);
      check('the welcome goes now', rows[0] ? Math.abs(minutesFrom(fireTime.getTime(), rows[0].run_at)) <= 1 : false, rows[0] ? `${minutesFrom(fireTime.getTime(), rows[0].run_at)} min` : 'missing');
      check('the brochure goes in exactly two days', rows[1] ? Math.abs(minutesFrom(fireTime.getTime(), rows[1].run_at) - 2880) <= 1 : false, rows[1] ? `${minutesFrom(fireTime.getTime(), rows[1].run_at)} min` : 'missing');
      check('with the right templates', rows[0]?.payload?.templateName === 'acceptances_welcome' && rows[1]?.payload?.templateName === 'acceptances_brochure', `${rows[0]?.payload?.templateName} / ${rows[1]?.payload?.templateName}`);

      // A lead from a DIFFERENT campaign must not be touched by it.
      const { data: otherLead } = await db
        .from('leads')
        .insert({ user_id: TEST_USER, name: 'Other campaign lead', phone: '919999000002', status: 'new', campaign_id: 'accept_campaign_2' })
        .select('id')
        .single();
      const otherFired = await fireFlowTrigger(db, {
        userId: TEST_USER,
        trigger: 'trigger_meta_ad',
        leadId: otherLead!.id,
        now: new Date(),
      });
      check('a lead from another campaign is left alone', otherFired.started.length === 0, otherFired.started.map((s) => s.title).join(', ') || 'nothing started');
      await db.from('leads').delete().eq('id', otherLead!.id);
    } finally {
      await db.from(SCHEDULES).delete().eq('flow_id', campaignAutomation.id);
      await db.from(RUNS).delete().eq('flow_id', campaignAutomation.id);
      await db.from('agent_pending_deliveries').delete().eq('flow_id', campaignAutomation.id);
      await db.from('automations').delete().eq('id', campaignAutomation.id);
    }
  } finally {
    await clean();
    const leftovers = await db.from(SCHEDULES).select('id').eq('flow_id', automation.id);
    console.log(`\ncleaned up: ${(leftovers.data ?? []).length === 0 ? 'yes' : 'NO — rows remain'}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
})();
