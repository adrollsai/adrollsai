/**
 * Proves sequences time themselves correctly.
 *
 * These are the cases a business owner describes in one sentence and never thinks about again:
 *
 *   "send the intro now, the brochure in two days"
 *   "remind them 24 hours before the meeting, then 30 minutes before"
 *
 * Every way that sentence can go wrong is silent in production. A two-day wait that fires at once
 * looks like enthusiasm; a reminder that fires after the meeting it describes looks like a bug the
 * customer discovers before we do. So the arithmetic and the refusals are both proven here.
 *
 *   npm run verify:sequences
 */
import {
  actionForStep,
  planTimes,
  type SequenceAction,
} from '../lib/flows/sequence';
import { DEFAULT_QUIET_HOURS } from '../lib/flows/scheduling';
import { buildFlow } from '../lib/agent/tools/flows';
import { planFromFlowDescription, storedTrigger } from '../lib/flows/start';
import { matchesFlowTrigger } from '../lib/flows/ingress';
import { actionsAvailableFor, TRIGGER_CAPABILITIES } from '../lib/flows/capabilities';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}
const head = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);

/** Quiet hours off, so the arithmetic is the only thing under test. */
const NO_QUIET = { startHour: 0, endHour: 0 };

/** 10:00 on a Tuesday, IST. */
const START = new Date('2026-11-24T04:30:00Z');
const minutesAfter = (base: Date, date: Date) => Math.round((date.getTime() - base.getTime()) / 60000);

head('1. "Now, then again in two days"');

{
  const steps: SequenceAction[] = [
    { kind: 'message', templateName: 'intro_now' },
    { kind: 'message', templateName: 'brochure_2d', delayMinutes: 2 * 24 * 60 },
  ];
  const plan = planTimes(steps, { startAt: START, quiet: NO_QUIET });

  check('both steps are scheduled', plan.at.length === 2, `${plan.at.length} steps`);
  const [first, second] = plan.at;
  check('the first goes out immediately', first && minutesAfter(START, first.runAt) === 0, first ? `${minutesAfter(START, first.runAt)} min` : 'missing');
  check('the second waits exactly two days', second && minutesAfter(START, second.runAt) === 2 * 24 * 60, second ? `${minutesAfter(START, second.runAt)} min` : 'missing');
  check('nothing was dropped', plan.dropped.length === 0);
  check('and it did not need an event time', plan.usedAnchor === false);
}

head('2. "24 hours before the meeting, then 30 minutes before"');

{
  const meeting = new Date('2026-11-26T06:30:00Z'); // 12:00 IST, two days out
  const steps: SequenceAction[] = [
    { kind: 'message', templateName: 'day_before', beforeEventMinutes: 24 * 60 },
    { kind: 'message', templateName: 'thirty_min', beforeEventMinutes: 30 },
  ];
  const plan = planTimes(steps, { startAt: START, anchorAt: meeting, quiet: NO_QUIET });

  check('both reminders are scheduled', plan.at.length === 2, `${plan.at.length} steps`);
  check('the first is exactly 24h before the meeting', plan.at[0] && minutesAfter(meeting, plan.at[0].runAt) === -24 * 60, plan.at[0] ? `${minutesAfter(meeting, plan.at[0].runAt)} min` : 'missing');
  check('the second is exactly 30 min before the meeting', plan.at[1] && minutesAfter(meeting, plan.at[1].runAt) === -30, plan.at[1] ? `${minutesAfter(meeting, plan.at[1].runAt)} min` : 'missing');
  check('both are marked as anchored to the event', plan.at.every((step) => step.anchored));
  check('they run in chronological order', plan.at[0].runAt.getTime() < plan.at[1].runAt.getTime());
}

head('3. A reminder whose moment has already passed is NEVER sent late');

{
  // Booked for 09:00 tomorrow, but the sequence starts at 10:00 the day before: the "24h before"
  // moment was an hour ago. Sending it now would say "your meeting is tomorrow" when it is in 23h.
  const meeting = new Date(START.getTime() + 23 * 60 * 60 * 1000);
  const plan = planTimes(
    [
      { kind: 'message', templateName: 'day_before', beforeEventMinutes: 24 * 60 },
      { kind: 'message', templateName: 'thirty_min', beforeEventMinutes: 30 },
    ],
    { startAt: START, anchorAt: meeting, quiet: NO_QUIET }
  );

  check('the missed reminder is not scheduled', plan.at.length === 1, `${plan.at.length} scheduled`);
  check('the one that is still ahead of us is', plan.at[0]?.kind === 'message');
  check('and the skip is reported, with a reason a person can read', plan.dropped.length === 1 && plan.dropped[0].reason === 'already_past_for_this_event', plan.dropped[0]?.message ?? 'none');
  check('the report points at the right step', plan.dropped[0]?.position === 0, String(plan.dropped[0]?.position));
}

head('4. An appointment-only step with no appointment is reported, not guessed');

{
  const plan = planTimes([{ kind: 'message', templateName: 'day_before', beforeEventMinutes: 60 }], {
    startAt: START,
    quiet: NO_QUIET,
  });
  check('nothing is scheduled without an event time', plan.at.length === 0, `${plan.at.length} scheduled`);
  check('and it says why', plan.dropped[0]?.reason === 'no_event_time', plan.dropped[0]?.message ?? 'none');
}

head('5. Quiet hours never push a reminder past the meeting');

{
  // 02:00 IST meeting: "30 minutes before" is 01:30, inside quiet hours (21:00-09:00). The next
  // allowed hour is 09:00, which is AFTER the meeting — so it must be dropped, not sent at 09:00.
  const meeting = new Date('2026-11-25T20:30:00Z'); // 02:00 IST
  const plan = planTimes([{ kind: 'message', templateName: 'thirty_min', beforeEventMinutes: 30 }], {
    startAt: new Date('2026-11-25T12:00:00Z'),
    anchorAt: meeting,
    quiet: DEFAULT_QUIET_HOURS,
  });
  check('the reminder is dropped rather than moved after the meeting', plan.at.length === 0, `${plan.at.length} scheduled`);
  check('with the quiet-hours reason', plan.dropped[0]?.reason === 'quiet_hours_would_land_after_the_event', plan.dropped[0]?.reason ?? 'none');
}

head('6. A daytime appointment keeps its reminder when quiet hours allow it');

{
  // 11:00 IST meeting, "24h before" = 11:00 the day before — nowhere near quiet hours.
  const meeting = new Date('2026-11-26T05:30:00Z');
  const plan = planTimes([{ kind: 'message', templateName: 'day_before', beforeEventMinutes: 24 * 60 }], {
    startAt: START,
    anchorAt: meeting,
    quiet: DEFAULT_QUIET_HOURS,
  });
  check('it survives', plan.at.length === 1, `${plan.at.length} scheduled`);
  check('at the right moment', plan.at[0] && minutesAfter(meeting, plan.at[0].runAt) === -24 * 60);
}

head('7. The step a scheduled row belongs to is the step, not the wait');

{
  // THE BUG THIS EXISTS FOR: step ids count runnable actions, but the old code indexed the raw
  // actions array — which contains the delays. "template A, wait two days, template B" therefore
  // resolved step 1 to the WAIT and sent an empty message.
  const steps: SequenceAction[] = [
    { kind: 'message', templateName: 'intro_now' },
    { kind: 'wait', seconds: 60 } as SequenceAction,
    { kind: 'message', templateName: 'brochure_2d', delayMinutes: 2 * 24 * 60 },
  ];
  check('step 0 is the first message', actionForStep(steps, 0)?.templateName === 'intro_now', String(actionForStep(steps, 0)?.templateName));
  check('step 1 is the SECOND message, not the wait', actionForStep(steps, 1)?.templateName === 'brochure_2d', String(actionForStep(steps, 1)?.templateName));
  check('and there is no step 2', actionForStep(steps, 2) === null);

  const plan = planTimes(steps, { startAt: START, quiet: NO_QUIET });
  check('the wait does not create a scheduled row', plan.at.length === 2, `${plan.at.length} rows`);
  const secondWait = plan.at[1] ? minutesAfter(START, plan.at[1].runAt) : -1;
  check(
    'the second row waits two days, plus the one-minute wait before it',
    secondWait === 2 * 24 * 60 + 1,
    `${secondWait} min`
  );
}

head('8. A plain flow behaves exactly as it did before');

{
  const plan = planTimes(
    [
      { kind: 'message', delayMinutes: 0 },
      { kind: 'message', delayMinutes: 60 },
      { kind: 'handoff' },
    ],
    { startAt: START, quiet: NO_QUIET }
  );
  check('three steps scheduled', plan.at.length === 3, `${plan.at.length}`);
  check('the 1-hour wait is honoured', plan.at[1] && minutesAfter(START, plan.at[1].runAt) === 60, plan.at[1] ? `${minutesAfter(START, plan.at[1].runAt)} min` : 'missing');
  check('the handoff is last', plan.at[2]?.kind === 'handoff');
  check('no event time was needed', plan.usedAnchor === false);
}

head('9. What the owner says becomes the schedule that runs');

{
  /**
   * The whole chain, from the sentence to the times: the agent calls create_flow, which stores a
   * description; a webhook fires the trigger, which parses that description back into actions; the
   * planner turns those actions into absolute times. Every hop has its own vocabulary, and the
   * failure mode is that one hop quietly drops a field — a delay that becomes zero, a template that
   * becomes null. So this walks the real functions rather than a hand-written action list.
   */

  // "when a lead comes from the campaign I just launched, send the intro now, the brochure in 2 days"
  const authored = buildFlow({
    name: 'New campaign lead welcome',
    trigger: 'trigger_meta_ad',
    campaignId: '120253296375050153',
    isActive: false,
    steps: [
      { kind: 'template', templateName: 'lead_journey_first_reply' },
      { kind: 'template', templateName: 'brochure_followup', delayMinutes: 2 * 24 * 60 },
    ],
  });

  const parsed = planFromFlowDescription(authored.description);
  check('the stored description parses back with no problems', parsed.problems.length === 0, parsed.problems.join('; ') || 'clean');
  check('both template steps survive the round trip', parsed.actions.filter((a) => a.templateName).length === 2, parsed.actions.map((a) => a.templateName ?? a.kind).join(', '));
  check('the campaign is stored on the trigger', storedTrigger(authored.description)?.campaignId === '120253296375050153', String(storedTrigger(authored.description)?.campaignId));

  const plan = planTimes(parsed.actions, { startAt: START, quiet: NO_QUIET });
  check('two sends are scheduled', plan.at.length === 2, `${plan.at.length}`);
  check('the first is immediate', plan.at[0] && minutesAfter(START, plan.at[0].runAt) === 0);
  check('the second is exactly two days later', plan.at[1] && minutesAfter(START, plan.at[1].runAt) === 2 * 24 * 60, plan.at[1] ? `${minutesAfter(START, plan.at[1].runAt)} min` : 'missing');
  check('and it is the brochure template that goes second', actionForStep(parsed.actions, 1)?.templateName === 'brochure_followup', String(actionForStep(parsed.actions, 1)?.templateName));

  // "when someone books, send the confirmation 24h before and the directions 30 min before"
  const bookingFlow = buildFlow({
    name: 'Appointment reminders',
    trigger: 'trigger_booking_created',
    isActive: false,
    steps: [
      { kind: 'template', templateName: 'reminder_24h', beforeEventMinutes: 24 * 60 },
      { kind: 'template', templateName: 'reminder_30m', beforeEventMinutes: 30 },
    ],
  });
  const bookingParsed = planFromFlowDescription(bookingFlow.description);
  check('the booking sequence parses cleanly', bookingParsed.problems.length === 0, bookingParsed.problems.join('; ') || 'clean');

  const meeting = new Date('2026-11-26T06:30:00Z');
  const bookingPlan = planTimes(bookingParsed.actions, { startAt: START, anchorAt: meeting, quiet: NO_QUIET });
  check('both reminders are scheduled', bookingPlan.at.length === 2, `${bookingPlan.at.length}`);
  check('one lands 24h before the meeting', bookingPlan.at[0] && minutesAfter(meeting, bookingPlan.at[0].runAt) === -24 * 60);
  check('the other lands 30 min before', bookingPlan.at[1] && minutesAfter(meeting, bookingPlan.at[1].runAt) === -30);
}

head('10. The right sequence fires, and only the right one');

{
  const matches = (description: string, event: any) => matchesFlowTrigger({ trigger: storedTrigger(description) }, event).matches;

  const scoped = buildFlow({
    name: 'Scoped',
    trigger: 'trigger_meta_ad',
    campaignId: 'camp_123',
    isActive: false,
    steps: [{ kind: 'template', templateName: 't1' }],
  }).description;
  const unscoped = buildFlow({
    name: 'Unscoped',
    trigger: 'trigger_meta_ad',
    isActive: false,
    steps: [{ kind: 'template', templateName: 't1' }],
  }).description;

  check('a lead from the named campaign fires it', matches(scoped, { trigger: 'trigger_meta_ad', campaignId: 'camp_123' }));
  check('a lead from a different campaign does not', !matches(scoped, { trigger: 'trigger_meta_ad', campaignId: 'camp_999' }));
  check('and a lead with no campaign does not', !matches(scoped, { trigger: 'trigger_meta_ad', campaignId: null }));
  check('a sequence with no campaign scope fires for any lead', matches(unscoped, { trigger: 'trigger_meta_ad', campaignId: 'camp_999' }));

  const booking = buildFlow({
    name: 'Booking',
    trigger: 'trigger_booking_created',
    isActive: false,
    steps: [{ kind: 'template', templateName: 't1' }],
  }).description;
  check('the booking trigger is a fireable event', Boolean(TRIGGER_CAPABILITIES.trigger_booking_created), TRIGGER_CAPABILITIES.trigger_booking_created?.label ?? 'missing');
  check('and it can drive a WhatsApp message', actionsAvailableFor('trigger_booking_created').includes('message'), actionsAvailableFor('trigger_booking_created').join(', '));
  check('a booking event fires the booking sequence', matches(booking, { trigger: 'trigger_booking_created' }));
  check('but a lead event does not', !matches(booking, { trigger: 'trigger_meta_ad', campaignId: 'camp_123' }));
}

head('11. Refusals are specific, and say what to do instead');

{
  const throwsWith = (fn: () => unknown, reason: string) => {
    try {
      fn();
      return false;
    } catch (error: any) {
      return error?.reason === reason;
    }
  };

  check(
    'an appointment-relative step on a non-booking trigger is refused',
    throwsWith(
      () =>
        buildFlow({
          name: 'x',
          trigger: 'trigger_meta_ad',
          isActive: false,
          steps: [{ kind: 'template', templateName: 't', beforeEventMinutes: 1440 }],
        }),
      'needs_booking_trigger'
    )
  );
  check(
    'a template step with no template is refused',
    throwsWith(
      () => buildFlow({ name: 'x', trigger: 'trigger_meta_ad', isActive: false, steps: [{ kind: 'template' }] }),
      'no_template'
    )
  );
  check(
    'an absurd delay is refused rather than stored',
    throwsWith(
      () =>
        buildFlow({
          name: 'x',
          trigger: 'trigger_meta_ad',
          isActive: false,
          steps: [{ kind: 'template', templateName: 't', delayMinutes: 400 * 24 * 60 }],
        }),
      'delay_too_long'
    )
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
