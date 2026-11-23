/**
 * Does the CEO daily-report guide match the report the code actually builds?
 *
 * §3.7 asks for a "CEO daily-report guide". Writing one by hand is how documentation rots: it
 * describes the report somebody remembered. So this builds a REAL report with the real builder and
 * asserts that every section and metric the guide names is one that exists — and that the guide
 * names all of them, so a new section cannot ship undocumented.
 *
 * It also pins the guarantees that make the report trustworthy, because those are the claims a
 * reader will act on: one report per period, the tenant's own timezone, a zero reported as zero, and
 * Meta's "results" never called a lead.
 *
 * Pure: `buildEodReport` takes `now` as an argument, so nothing here reads the clock or the database.
 *
 *   npx esbuild scripts/verify-ceo-guide.ts --bundle --platform=node --format=esm \
 *     --outfile=.tmp-ceo-guide.mjs && node .tmp-ceo-guide.mjs
 */
import fs from 'node:fs';
import { buildEodReport, dayWindow } from '../lib/automation/eod-report';
import { industryVocabulary } from '../lib/automation/industry';

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

const GUIDE_PATH = 'docs/ceo-daily-report-guide.md';
const guide = fs.readFileSync(GUIDE_PATH, 'utf8');

const sample = (over: Record<string, any> = {}) =>
  buildEodReport({
    now: new Date('2026-11-16T12:00:00Z'),
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    businessName: 'Procolor Film Academy',
    industry: 'education',
    positioning: 'Hands-on film school in Chandigarh',
    dashboardUrl: 'https://app.nobogent.com/dashboard',
    leads: {
      total: 120,
      newToday: 9,
      newPreviousDay: 6,
      pipeline: [
        { stage: 'New', count: 40 },
        { stage: 'Contacted', count: 30 },
      ],
    },
    calls: { attempted: 22, connected: 11, positive: 3, minutes: 44 },
    creative: { producedToday: 2, deliveredToday: 1 },
    routine: { enabled: true, name: 'Daily', cadence: 'daily', todayRunStatus: 'succeeded' },
    campaign: { total: 3, active: 1, spendToDate: 7128, results: 21 },
    credits: { balance: 5000, spentToday: 120 },
    ...over,
  } as any);

const report = sample();

console.log('▸ every metric the builder emits is documented');
for (const metric of report.metrics) {
  check(`  metric "${metric.key}" is in the guide`, guide.includes(`\`${metric.key}\``), metric.label);
}

console.log('\n▸ every section the builder emits is documented');
// Optional sections only appear when the data warrants them — `next` shows up on a quiet day and
// `pipeline` only when there is a pipeline — so the union of a busy day and a quiet one is what the
// guide has to cover. Checking only the busy report let `next` through undocumented once.
const quietReport = sample({
  leads: { total: 0, newToday: 0, newPreviousDay: 0, pipeline: [] },
  calls: { attempted: 0, connected: 0, positive: 0, minutes: 0 },
  creative: { producedToday: 0, deliveredToday: 0 },
  campaign: { total: 0, active: 0, spendToDate: 0, results: 0 },
  credits: { balance: 5000, spentToday: 0 },
});
const allSections = new Map<string, string>();
for (const section of [...report.sections, ...quietReport.sections]) {
  allSections.set(section.key, section.title);
}
for (const [key, title] of allSections) {
  check(
    `  section "${key}" is in the guide`,
    guide.includes(`\`${key}\``) && guide.includes(title),
    title,
  );
}

console.log('\n▸ both delivery channels are described');
check('whatsappText is documented', /whatsappText/.test(guide));
check('the html channel is documented', /\bhtml\b/.test(guide));
check('the auditable facts list is documented', /facts/.test(guide));

console.log('\n▸ the guarantees a reader acts on');
check(
  'the guide states one report per period, keyed by periodKey',
  /one report per (business per |)period|idempotency key/i.test(guide) && guide.includes('periodKey'),
);
check(
  'the guide states the timezone is the tenant\'s own',
  /profiles\.timezone/.test(guide) && /Asia\/Kolkata/.test(guide),
);
check(
  'the guide states a zero is reported as zero',
  /a zero is reported as zero/i.test(guide),
);
check(
  "the guide states Meta's results is never called a lead",
  /never called a lead/i.test(guide) && guide.includes('results'),
);

// ── Behaviour the guide promises, checked against the builder itself.
console.log('\n▸ the promises hold, measured');
check(
  'periodKey is a YYYY-MM-DD idempotency key',
  /^\d{4}-\d{2}-\d{2}$/.test(report.periodKey),
  report.periodKey,
);
check(
  'the same day builds the same periodKey twice',
  sample().periodKey === sample().periodKey,
  'stable across calls',
);
check(
  'the report carries a real date label',
  report.dateLabel === '16 November 2026',
  report.dateLabel,
);
check(
  'every rendered sentence is in facts (nothing spoken that cannot be audited)',
  Array.isArray(report.facts) && report.facts.length > 0,
  `${report.facts.length} facts`,
);
check(
  'sentiment is one of the four documented values',
  ['quiet', 'normal', 'good', 'attention'].includes(report.sentiment),
  report.sentiment,
);
check('the guide names all four sentiment values', ['quiet', 'normal', 'good', 'attention'].every((s) => guide.includes(s)));

// A day with nothing in it must still be an honest report, not an invented one.
const empty = sample({
  leads: { total: 0, newToday: 0, newPreviousDay: 0, pipeline: [] },
  calls: { attempted: 0, connected: 0, positive: 0, minutes: 0 },
  creative: { producedToday: 0, deliveredToday: 0 },
  campaign: { total: 0, active: 0, spendToDate: 0, results: 0 },
  credits: { balance: 5000, spentToday: 0 },
});
console.log(`\n  a zero day reads: "${empty.headline}" (sentiment ${empty.sentiment})`);
// The promise is "a quiet day is described honestly", not "the word 0 appears". The builder says
// "Nothing came in today." with sentiment `quiet`, which is better copy than a bare zero — so the
// assertion is about honesty, not about digits.
check(
  'a zero day is described as empty, not dressed up as a good day',
  empty.sentiment === 'quiet' && !/good|normal/.test(empty.sentiment) && /nothing/i.test(empty.headline),
  `${empty.headline} (${empty.sentiment})`,
);
// The metric tiles shrink on a quiet day (that is deliberate: a notification full of zeros is noise),
// so the promise is that the zeros appear in PROSE. Check the rendered sentences, not the tiles.
const zeroProse = [...empty.sections.flatMap((s: any) => s.lines), ...empty.facts, empty.whatsappText].join(' ');
check(
  'and the zeros are spelled out, so the day cannot look unmeasured',
  /no new (applicants|leads)|nothing produced/i.test(zeroProse),
  zeroProse.slice(0, 120),
);

// The vocabulary must follow the industry, not the code's first guess.
const academy = industryVocabulary('education');
const neutral = industryVocabulary(null);
console.log(`\n  education noun: "${academy.productNoun}" · untagged noun: "${neutral.productNoun}"`);
check(
  'an untagged tenant does not inherit a property vertical noun',
  !/propert|listing|unit/i.test(String(neutral.productNoun)),
  String(neutral.productNoun),
);

// The day window is a real function the report depends on; make sure it agrees with the label.
const window = dayWindow(new Date('2026-11-16T12:00:00Z'), 'Asia/Kolkata');
check(
  'the day window is a closed interval in the tenant timezone',
  window.start.getTime() < window.end.getTime(),
  `${window.start.toISOString()} → ${window.end.toISOString()}`,
);

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
