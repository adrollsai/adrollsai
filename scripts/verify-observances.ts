/**
 * Festival and observance creatives, inside the routine.
 *
 * WHAT WAS MISSING
 * The routine was told "the calendar: any festival, holiday or event today or tomorrow" and given
 * nothing to read it with — no festival dates (the festival calendar was only wired for the standalone
 * festival cron) and no concept of observance days at all. So Women's Day, Earth Day, Environment Day,
 * Yoga Day and Mother's/Father's Day were nobody's job: not festivals, not in any table the routine
 * could see, and never in a brief. A business that wanted a Women's Day creative had to ask for it on
 * the day, which is the one day it is too late.
 *
 * What this asserts:
 *   1. the dates are right for any year (fixed days, and Nth-weekday days like Mother's Day);
 *   2. the window logic is right — inside the lead time means MAKE IT NOW, outside means plan only;
 *   3. the brief actually carries them, with the angle, and only when they are in the window;
 *   4. the honest-angle escape hatch survives, so the agent is never pushed into claiming something
 *      the business cannot support.
 *
 *   npm run verify:observances
 *
 * Pure: fixed instants, no database, no network.
 */
import {
  OBSERVANCES,
  describeObservance,
  nextObservance,
  observanceBriefLines,
  observanceDate,
  upcomingObservances,
} from '../lib/automation/observance-calendar';
import { composeRoutineBrief } from '../lib/automation/routine-composer';

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

const at = (iso: string) => new Date(iso);

// ── 1. the dates
console.log('\n▸ the days the owner named land on the right date');
const fixed: Array<[string, number, number, number]> = [
  ['womens_day', 3, 8, 2026],
  ['earth_day', 4, 22, 2026],
  ['environment_day', 6, 5, 2026],
  ['yoga_day', 6, 21, 2026],
  ['labour_day', 5, 1, 2026],
  ['childrens_day', 11, 14, 2026],
  ['christmas', 12, 25, 2027],
];
for (const [id, month, day, year] of fixed) {
  const observance = OBSERVANCES.find((o) => o.id === id);
  const resolved = observance ? observanceDate(observance.rule, year) : null;
  check(
    `${id} is ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')} in ${year}`,
    !!resolved && resolved.month === month && resolved.day === day,
    resolved ? `${resolved.year}-${resolved.month}-${resolved.day}` : 'not found',
  );
}

const mothers = OBSERVANCES.find((o) => o.id === 'mothers_day')!;
const fathers = OBSERVANCES.find((o) => o.id === 'fathers_day')!;
const mothers2026 = observanceDate(mothers.rule, 2026);
const fathers2026 = observanceDate(fathers.rule, 2026);
check(
  "Mother's Day 2026 is the 2nd Sunday of May (10 May)",
  mothers2026.month === 5 && mothers2026.day === 10,
  `${mothers2026.day} May 2026`,
);
check(
  "Father's Day 2026 is the 3rd Sunday of June (21 June)",
  fathers2026.month === 6 && fathers2026.day === 21,
  `${fathers2026.day} June 2026`,
);
check(
  'a date that collides with another observance is allowed and both survive',
  (() => {
    const list = upcomingObservances(at('2026-06-14T06:00:00Z'), { withinDays: 14, timezone: 'Asia/Kolkata' });
    const names = list.map((o) => o.name);
    return names.some((n) => /Yoga/.test(n)) && names.some((n) => /Father/.test(n));
  })(),
  '21 June 2026 is both Yoga Day and Father\'s Day — the brief must not pick one silently',
);
check(
  'every entry has an angle and a lead time, or it is not a usable day',
  OBSERVANCES.every((o) => o.angle.trim().length > 20 && Number.isInteger(o.leadDays) && o.leadDays >= 0),
  `${OBSERVANCES.length} observances`,
);
check('ids are unique', new Set(OBSERVANCES.map((o) => o.id)).size === OBSERVANCES.length);

// ── 2. the window and the lead time
console.log('\n▸ "in the window" decides whether to make it or plan it');
const womensWeek = upcomingObservances(at('2026-03-04T06:00:00Z'), { withinDays: 14, timezone: 'Asia/Kolkata' });
const wd = womensWeek.find((o) => o.id === 'womens_day');
check("Women's Day is in the window on 4 March", !!wd, wd ? describeObservance(wd) : 'missing');
check(
  'four days out is inside its 7-day lead time, so the creative is due NOW',
  !!wd && wd.daysAway === 4 && wd.needsCreativeNow === true,
  wd ? `daysAway=${wd.daysAway} needsCreativeNow=${wd.needsCreativeNow}` : '',
);
check(
  'the day itself still counts as due (not "too late to bother")',
  (() => {
    const onTheDay = upcomingObservances(at('2026-03-08T06:00:00Z'), { withinDays: 14, timezone: 'Asia/Kolkata' }).find(
      (o) => o.id === 'womens_day'
    );
    return !!onTheDay && onTheDay.daysAway === 0 && onTheDay.needsCreativeNow;
  })(),
);
check(
  'further out it is "plan only" rather than "make it"',
  (() => {
    const earlier = upcomingObservances(at('2026-02-20T06:00:00Z'), { withinDays: 40, timezone: 'Asia/Kolkata' }).find(
      (o) => o.id === 'womens_day'
    );
    return !!earlier && earlier.needsCreativeNow === false;
  })(),
  '16 days out, inside a 40-day window but outside the 7-day lead',
);
check(
  'the list is soonest-first',
  (() => {
    const list = upcomingObservances(at('2026-04-10T06:00:00Z'), { withinDays: 30, timezone: 'Asia/Kolkata' });
    return list.every((o, i) => i === 0 || list[i - 1].daysAway <= o.daysAway);
  })(),
);
check(
  'an empty window says nothing rather than inventing a day',
  upcomingObservances(at('2026-07-01T06:00:00Z'), { withinDays: 3, timezone: 'Asia/Kolkata' }).length === 0,
);

// ── 3. the year boundary and scopes
console.log('\n▸ late December looks into January');
check(
  "New Year's Day appears from 28 December",
  upcomingObservances(at('2026-12-28T06:00:00Z'), { withinDays: 7, timezone: 'Asia/Kolkata' }).some((o) => o.id === 'new_year'),
);
check(
  "and New Year's Eve is still ahead on 28 December",
  upcomingObservances(at('2026-12-28T06:00:00Z'), { withinDays: 7, timezone: 'Asia/Kolkata' }).some(
    (o) => o.id === 'new_years_eve'
  ),
);
check(
  "Teachers' Day is India-scoped and absent for a global-only tenant",
  (() => {
    const inWindow = at('2026-09-01T06:00:00Z');
    const withIndia = upcomingObservances(inWindow, { withinDays: 10, timezone: 'Asia/Kolkata', scopes: ['global', 'IN'] });
    const globalOnly = upcomingObservances(inWindow, { withinDays: 10, timezone: 'Asia/Kolkata', scopes: ['global'] });
    return (
      withIndia.some((o) => o.id === 'teachers_day') && !globalOnly.some((o) => o.id === 'teachers_day')
    );
  })(),
);
check(
  'nextObservance answers "when is the next Earth Day" from any date',
  nextObservance('earth_day', at('2026-05-01T06:00:00Z'))?.date === '2027-04-22',
  nextObservance('earth_day', at('2026-05-01T06:00:00Z'))?.date || 'none',
);

// ── 4. the brief carries them
console.log('\n▸ the routine brief actually raises them');
const briefFor = (now: Date) =>
  composeRoutineBrief({
    businessName: 'Test Realty',
    industry: 'real_estate',
    routine: {
      name: 'Daily marketing',
      intent: 'Make one strong piece of content a day and follow up with open leads.',
      cadence: 'daily',
      approval_policy: 'always',
      daily_credit_cap: 200,
      channels: ['whatsapp'],
      timezone: 'Asia/Kolkata',
    },
    todaysDate: '2026-03-04',
    now,
  }).text;

const brief = briefFor(at('2026-03-04T06:00:00Z'));
check(
  'the brief names the observance and its date',
  /International Women's Day/.test(brief) && /2026-03-08/.test(brief),
  (brief.match(/International Women's Day[^\n]*/) || [''])[0].slice(0, 90),
);
check(
  'and says the creative is due before the day, not on it',
  /before the day itself/.test(brief),
);
check(
  'the commercial angle travels with it, not just the greeting',
  /Women as owners and decision-makers/.test(brief),
);
check(
  'it forbids a greeting-card creative',
  /not a greeting card/.test(brief),
);
check(
  'and keeps the escape hatch for a business the day does not honestly fit',
  /If the honest angle does not exist, skip that day/.test(brief),
);
const calmBrief = briefFor(at('2026-07-01T06:00:00Z'));
check(
  'no observance in the window means no observance section at all',
  !/OBSERVANCE DAYS/.test(calmBrief),
);
check(
  'the plain "check the calendar" instruction is still there for festivals',
  /the calendar: any festival, holiday or event/.test(calmBrief),
);

// ── 5. the agent can see them without waiting for a run
console.log('\n▸ and the agent can answer "what is coming up?"');
const fs = await import('node:fs');
const routineTool = fs.readFileSync('lib/agent/tools/routine.ts', 'utf8');
check(
  'get_routine reports the observance days in the window',
  /observanceDays:\s*upcomingObservances\(/.test(routineTool),
);
check(
  'and says they are part of every run',
  /Festival and observance creatives are part of every routine run/.test(routineTool),
);
check(
  'the composer imports the calendar rather than re-deriving it',
  /from '\.\/observance-calendar'/.test(fs.readFileSync('lib/automation/routine-composer.ts', 'utf8')),
);
check(
  'the window is 14 days, long enough to plan and short enough to stay current',
  /OBSERVANCE_WINDOW_DAYS = 14/.test(fs.readFileSync('lib/automation/routine-composer.ts', 'utf8')),
);
check('observanceBriefLines produces both asks when both apply', (() => {
  const lines = observanceBriefLines(
    upcomingObservances(at('2026-03-04T06:00:00Z'), { withinDays: 30, timezone: 'Asia/Kolkata' })
  );
  return lines.some((l) => l.startsWith('- MAKE SOMETHING NOW')) && lines.some((l) => l.startsWith('- COMING UP'));
})());

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
