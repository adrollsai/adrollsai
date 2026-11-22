/**
 * WHEN the routine runs — arithmetic, not vibes.
 *
 * The defect this pins: `nextRunAfter()` decided the next slot by adding days to *now* and read
 * neither `run_at_hour` nor `timezone`. A routine whose row said "weekly at 18:00 Asia/Kolkata"
 * therefore fired at whatever clock time it was created, while the CEO tab, the agent's summary and
 * the owner all believed 6pm. Every case below is a fixed instant, so this passes or fails on the
 * arithmetic alone — no database, no clock.
 *
 *   npm run verify:schedule
 */
import { describeSchedule, instantForLocalHour, nextRunAt } from '../lib/agent/routine-schedule';
import { nextRunAfter } from '../lib/agent/routines';

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

const iso = (d: Date) => d.toISOString().replace('.000Z', 'Z');

// ── today at its own hour, in its own zone
console.log('\n▸ a routine runs at the hour it says');
const ist = { cadence: 'daily' as const, run_at_hour: 18, timezone: 'Asia/Kolkata' };

check(
  'daily 18:00 IST, asked at 10:00Z (15:30 IST) -> today 18:00 IST = 12:30Z',
  iso(nextRunAt(new Date('2026-11-22T10:00:00Z'), ist)) === '2026-11-22T12:30:00Z',
  iso(nextRunAt(new Date('2026-11-22T10:00:00Z'), ist)),
);
check(
  'the same routine asked at 13:00Z (18:30 IST) -> tomorrow 12:30Z, not "in 24h from now"',
  iso(nextRunAt(new Date('2026-11-22T13:00:00Z'), ist)) === '2026-11-23T12:30:00Z',
  iso(nextRunAt(new Date('2026-11-22T13:00:00Z'), ist)),
);
check(
  'the old behaviour would have produced the same clock time as `now`',
  iso(nextRunAt(new Date('2026-11-22T13:07:41Z'), ist)) === '2026-11-23T12:30:00Z',
  'no minute/second bleed into the schedule',
);
check(
  'a 07:00 IST routine asked at 10:00Z (15:30 IST) -> tomorrow 01:30Z',
  iso(nextRunAt(new Date('2026-11-22T10:00:00Z'), { ...ist, run_at_hour: 7 })) === '2026-11-23T01:30:00Z',
  'morning slots do not fire in the afternoon',
);

// ── cadence
console.log('\n▸ cadence steps the right number of days, at the same hour');
check(
  'weekly, asked after its slot has gone, moves to the same slot 7 days on',
  iso(nextRunAt(new Date('2026-11-22T13:00:00Z'), { ...ist, cadence: 'weekly' })) === '2026-11-29T12:30:00Z',
  iso(nextRunAt(new Date('2026-11-22T13:00:00Z'), { ...ist, cadence: 'weekly' })),
);
check(
  'weekly, asked 30 minutes before its slot, lands on that slot',
  iso(nextRunAt(new Date('2026-11-22T12:00:00Z'), { ...ist, cadence: 'weekly' })) === '2026-11-22T12:30:00Z',
);
check(
  'the week after that is exactly 7 days later',
  (() => {
    const first = nextRunAt(new Date('2026-11-22T12:00:00Z'), { ...ist, cadence: 'weekly' });
    const second = nextRunAt(first, { ...ist, cadence: 'weekly' });
    return Math.round((second.getTime() - first.getTime()) / 86_400_000) === 7;
  })(),
);
check(
  'monthly, asked after its slot has gone, moves to the same date next month',
  iso(nextRunAt(new Date('2026-11-22T10:00:00Z'), { ...ist, cadence: 'monthly', run_at_hour: 7 })) === '2026-12-22T01:30:00Z',
  iso(nextRunAt(new Date('2026-11-22T10:00:00Z'), { ...ist, cadence: 'monthly', run_at_hour: 7 })),
);
check(
  'and a slot still ahead today is taken today, whatever the cadence',
  iso(nextRunAt(new Date('2026-11-22T12:00:00Z'), { ...ist, cadence: 'monthly' })) === '2026-11-22T12:30:00Z',
  'nobody waits a month for a slot that has not passed',
);

// ── other zones, and DST
console.log('\n▸ other timezones, including a DST boundary');
check(
  '09:00 America/New_York -> 14:00Z (EST, UTC-5)',
  iso(nextRunAt(new Date('2026-11-22T10:00:00Z'), { cadence: 'daily', run_at_hour: 9, timezone: 'America/New_York' })) ===
    '2026-11-22T14:00:00Z',
);
check(
  '09:00 America/New_York in July -> 13:00Z (EDT, UTC-4)',
  iso(nextRunAt(new Date('2026-07-10T10:00:00Z'), { cadence: 'daily', run_at_hour: 9, timezone: 'America/New_York' })) ===
    '2026-07-10T13:00:00Z',
);
check(
  'UTC is honoured as itself',
  iso(nextRunAt(new Date('2026-11-22T10:00:00Z'), { cadence: 'daily', run_at_hour: 18, timezone: 'UTC' })) ===
    '2026-11-22T18:00:00Z',
);
check(
  'a half-hour offset zone works too (Asia/Kolkata is +05:30)',
  new Date('2026-11-22T12:30:00Z').getTime() === instantForLocalHour({ year: 2026, month: 11, day: 22 }, 18, 'Asia/Kolkata').getTime(),
);

// ── nonsense input never schedules in the past
console.log('\n▸ bad input degrades to something sane, never to the past');
const now = new Date('2026-11-22T10:00:00Z');
for (const spec of [
  {},
  { cadence: 'hourly' as any, run_at_hour: 18, timezone: 'Asia/Kolkata' },
  { cadence: 'daily' as any, run_at_hour: 99, timezone: 'Asia/Kolkata' },
  { cadence: 'daily' as any, run_at_hour: -3, timezone: 'Asia/Kolkata' },
  { cadence: 'daily' as any, run_at_hour: 'nonsense' as any, timezone: 'Asia/Kolkata' },
]) {
  const next = nextRunAt(now, spec as any);
  check(
    `never in the past (${JSON.stringify(spec)})`,
    next.getTime() > now.getTime(),
    iso(next),
  );
}
check(
  'missing everything defaults to 07:00 Asia/Kolkata',
  iso(nextRunAt(now, {})) === '2026-11-23T01:30:00Z',
  iso(nextRunAt(now, {})),
);

// ── the two callers, wired to it
console.log('\n▸ the scheduler and the agent use the same arithmetic');
check(
  'the cron\'s nextRunAfter delegates to nextRunAt',
  (() => {
    const routine: any = { cadence: 'daily', run_at_hour: 18, timezone: 'Asia/Kolkata' };
    return (
      nextRunAfter(now, routine).getTime() ===
      nextRunAt(now, { cadence: 'daily', run_at_hour: 18, timezone: 'Asia/Kolkata' }).getTime()
    );
  })(),
  'a bump after a run keeps the routine at its own hour',
);
const fs = await import('node:fs');
const routineTool = fs
  .readFileSync('lib/agent/tools/routine.ts', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');
check('the routine tool schedules with nextRunAt', /nextRunAt\(now,/.test(routineTool) && !/nextRunAfter\(/.test(routineTool));
check(
  'and it tells the owner the schedule in words',
  /describeSchedule\(/.test(routineTool),
  (() => {
    try {
      return describeSchedule({ cadence: 'weekly', run_at_hour: 18, timezone: 'Asia/Kolkata' }, new Date('2026-11-22T12:30:00Z'));
    } catch {
      return '(describeSchedule threw)';
    }
  })(),
);

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
