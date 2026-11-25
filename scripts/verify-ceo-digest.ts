/**
 * Proves the CEO email sweep scales past one invocation.
 *
 * The bug this guards against is silent: the digest cron used to walk every enabled business in a
 * single 300-second invocation. At twelve businesses that works. At the size of the platform it
 * does not — the browser-less loop is killed part-way, the businesses early in the table get their
 * email, and the rest never do with no error anyone sees. Turning the CEO on for every account is
 * only safe if this converges, so the sweep is simulated here rather than assumed.
 *
 *   - a business is only emailed inside its own window, in its own timezone
 *   - the middle of the night produces nothing, even though the cron runs then
 *   - repeated invocations eventually reach everyone, and never mail anyone twice
 *
 *   npm run verify:ceo-digest
 */
import { digestSlotFor, localHour, planDigestSends, type DigestSlot } from '../lib/agent/digest-batch';
import { readFileSync } from 'node:fs';
import path from 'node:path';

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

/** 07:00 in Asia/Kolkata is 01:30 UTC — the whole point of resolving per business. */
const IST_7AM = new Date('2026-11-25T01:30:00Z');
const IST_NOON = new Date('2026-11-25T06:30:00Z');
const IST_7PM = new Date('2026-11-25T13:30:00Z');
const IST_2AM = new Date('2026-11-24T20:30:00Z');

head('1. The window is in the business\u2019s own clock');

{
  check('07:00 IST is the morning plan', digestSlotFor(IST_7AM, 'Asia/Kolkata') === 'morning', String(digestSlotFor(IST_7AM, 'Asia/Kolkata')));
  check('19:00 IST is the evening wrap', digestSlotFor(IST_7PM, 'Asia/Kolkata') === 'eod', String(digestSlotFor(IST_7PM, 'Asia/Kolkata')));
  check('midday is neither slot', digestSlotFor(IST_NOON, 'Asia/Kolkata') === null, String(digestSlotFor(IST_NOON, 'Asia/Kolkata')));
  check('02:00 IST sends nothing', digestSlotFor(IST_2AM, 'Asia/Kolkata') === null, String(digestSlotFor(IST_2AM, 'Asia/Kolkata')));

  // Same instant, two businesses: the Indian one is at 07:00, the London one at 01:30.
  check('the same instant is morning for IST and night for London', digestSlotFor(IST_7AM, 'Europe/London') === null, String(digestSlotFor(IST_7AM, 'Europe/London')));
  check('and the hour really is local', localHour(IST_7AM, 'Asia/Kolkata') === 7, String(localHour(IST_7AM, 'Asia/Kolkata')));

  let threw = false;
  let unknown: DigestSlot | null = null;
  try {
    unknown = digestSlotFor(IST_7AM, 'Mars/Olympus_Mons');
  } catch {
    threw = true;
  }
  check('an unknown timezone falls back instead of throwing', !threw && unknown === 'morning', String(unknown));
  check('a business with no timezone uses the product default', digestSlotFor(IST_7AM, null) === 'morning', String(digestSlotFor(IST_7AM, null)));
}

head('2. One invocation sends at most its limit');

{
  const routines = Array.from({ length: 30 }, (_, i) => ({ user_id: `u${i}`, timezone: 'Asia/Kolkata' }));
  const plan = planDigestSends(routines, { now: IST_7AM, isSent: () => false, limit: 12 });
  check('sends exactly the limit', plan.due.length === 12, String(plan.due.length));
  check('and reports the rest as deferred, not dropped', plan.deferred === 18, String(plan.deferred));
  check('everything is on the morning slot', plan.due.every((item) => item.slot === 'morning'));

  const sent = new Set(plan.due.map((item) => item.routine.user_id));
  const second = planDigestSends(routines, {
    now: IST_7AM,
    isSent: (routine) => sent.has(routine.user_id),
    limit: 12,
  });
  check('the next invocation continues where the last stopped', !second.due.some((item) => sent.has(item.routine.user_id)), `${second.due.length} fresh`);
  check('and counts what is already done', second.alreadySent === 12, String(second.alreadySent));
}

head('3. Outside the window, nothing is sent at all');

{
  const routines = [{ user_id: 'a', timezone: 'Asia/Kolkata' }];
  const night = planDigestSends(routines, { now: IST_2AM, isSent: () => false, limit: 12 });
  check('2am sends nothing', night.due.length === 0, String(night.due.length));
  check('and says why: outside the window', night.outsideWindow === 1, String(night.outsideWindow));
  check('a forced slot ignores the window (manual send)', planDigestSends(routines, { now: IST_2AM, forcedSlot: 'eod', isSent: () => false, limit: 12 }).due.length === 1);
}

head('4. The whole platform is reached, and never mailed twice');

{
  // 79 businesses: the size the CEO has once it is on for every account.
  const routines = Array.from({ length: 79 }, (_, i) => ({
    user_id: `biz-${String(i).padStart(2, '0')}`,
    timezone: 'Asia/Kolkata',
  }));
  const sentOnce = new Map<string, number>();
  let invocations = 0;
  let duplicates = 0;

  // 24 invocations = six hours of the fifteen-minute cron, which is one morning window.
  for (let tick = 0; tick < 24; tick++) {
    invocations++;
    const plan = planDigestSends(routines, {
      now: IST_7AM,
      isSent: (routine, slot) => sentOnce.has(`${routine.user_id}|${slot}`),
      limit: 12,
    });
    for (const item of plan.due) {
      const key = `${item.routine.user_id}|${item.slot}`;
      if (sentOnce.has(key)) duplicates++;
      sentOnce.set(key, tick);
    }
    if (plan.deferred === 0 && plan.alreadySent === routines.length) break;
  }

  check('every one of the 79 businesses was reached', sentOnce.size === 79, `${sentOnce.size}/79 after ${invocations} invocations`);
  check('and not one of them was mailed twice', duplicates === 0, String(duplicates));
  check('it converges well inside the morning window', invocations <= 12, `${invocations} invocations of 12`);
}

head('5. A business is never mailed twice for the same slot');

{
  /**
   * The stamp that makes a send "done" lives on `routine_runs.digest`, so a business with no run
   * row for the period has nowhere to record the send. With the old twice-daily cron that was one
   * duplicate; the cron now runs every fifteen minutes, so it would be two dozen. Two structural
   * rules keep that impossible, and both are cheap to break silently — hence the check.
   */
  const routeSrc = readFileSync(path.join(process.cwd(), 'app/api/cron/ceo-digest/route.ts'), 'utf8');

  check(
    'the route refuses to send without a run row to stamp',
    /if \(!run\?\.id\)/.test(routeSrc) && /skipped\.push\([^)]*no run for/.test(routeSrc),
    'no run → no email',
  );
  check(
    'the period key honours the routine\u2019s own cadence',
    /periodKey\(now,[^)]*routine\.cadence \|\| 'daily'\)/.test(routeSrc),
    'a weekly routine is not looked up under a daily key',
  );
  check(
    'the cron sweeps more than twice a day',
    (() => {
      const crons = JSON.parse(readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8')).crons || [];
      const digest = crons.filter((cron: any) => String(cron.path).startsWith('/api/cron/ceo-digest'));
      return digest.length === 1 && digest[0].schedule === '*/15 * * * *';
    })(),
    'one every-fifteen-minutes entry, not two fixed times',
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
