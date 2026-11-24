/**
 * Proves the daily report is written for a business owner, not for a marketer.
 *
 * WHY THIS GATE EXISTS
 * The report's first version was technically correct and practically unreadable. It said
 * "cost per lead has risen" and "40% of calls connected" and "0 routine(s) ran". An owner running
 * a film academy or a clinic has no reason to know what CPL, CTR or an ad set is, and a report
 * they cannot read is a report they stop opening — at which point the whole engine is a receipt
 * nobody collects.
 *
 * So the plain-language rule is not a style preference, it is a product requirement with the same
 * standing as "never invent a number". These checks fail the build on:
 *
 *   1. JARGON in any owner-facing string: acronyms, terms of art, and percentages.
 *   2. A NUMBER WITH NOTHING TO COMPARE IT TO — "12 enquiries" is trivia; "12 enquiries, 4 more
 *      than the week before" is information. Where a previous value exists, the sentence must use it.
 *   3. AN EMPTY OR VAGUE RECOMMENDATION. Every finding has to end in something a person can say
 *      yes to.
 *   4. INTERNAL NAMES leaking into the interface ("Daily engine", "Cadence", "findings").
 *   5. The report reading like a machine wrote it: no "successfully", no "great", no past-tense
 *      claims of actions it did not take.
 *
 *   npm run verify:ceo-plain-language
 */
import fs from 'node:fs';
import { analyseDay, renderReport, summariseFindings, type DayMetrics, type Finding } from '../lib/agent/ceo-findings';

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

/**
 * The ban list.
 *
 * Every entry is a word that has to be learned before it can be understood. `lead` is included
 * deliberately: the trade says "lead", the person paying says "enquiry", and the report is for the
 * person paying.
 */
const BANNED: { pattern: RegExp; why: string }[] = [
  { pattern: /\bCPL\b/i, why: 'cost per lead' },
  { pattern: /\bCPA\b/i, why: 'cost per acquisition' },
  { pattern: /\bCTR\b/i, why: 'click-through rate' },
  { pattern: /\bCPM\b/i, why: 'cost per thousand' },
  { pattern: /\bROAS\b/i, why: 'return on ad spend' },
  { pattern: /\bROI\b/i, why: 'return on investment' },
  { pattern: /\bKPI\b/i, why: 'key performance indicator' },
  { pattern: /\bimpressions?\b/i, why: 'say "people who saw it"' },
  { pattern: /\bfrequency\b/i, why: 'say "how often each person saw it"' },
  { pattern: /\battribut\w*/i, why: 'say "came from"' },
  { pattern: /\bfunnel\b/i, why: 'say "from enquiry to booking"' },
  { pattern: /\bad ?sets?\b/i, why: 'an internal Meta object' },
  { pattern: /\bangles?\b/i, why: 'say "the argument the ad makes"' },
  { pattern: /\bcadence\b/i, why: 'say "how often"' },
  { pattern: /\bcohort\b/i, why: 'no' },
  { pattern: /\bcreative plan\b/i, why: 'no' },
  { pattern: /\bengagement\b/i, why: 'say what actually happened' },
  { pattern: /\boptimi[sz]\w*/i, why: 'say what you are changing' },
  { pattern: /\bpipeline\b/i, why: 'say "people waiting on us"' },
  { pattern: /\bleads?\b/i, why: 'say "enquiries"' },
  { pattern: /\broutines?\b/i, why: 'say "daily marketing" or "daily job"' },
  { pattern: /\bengines?\b/i, why: 'it is a job, not an engine' },
  { pattern: /\bdeliverables?\b/i, why: 'say what was made' },
  { pattern: /\breach\b/i, why: 'say "people who saw it"' },
];

/**
 * Every situation the report can describe, so the copy is checked in all of them — not just the
 * happy path. Each one is a real case an owner has hit.
 */
function scenarios(): { name: string; metrics: DayMetrics }[] {
  const base: DayMetrics = {
    window: { from: '2026-02-01', to: '2026-02-02' },
    leads: { created: 12, contacted: 12, replied: 5, booked: 2, lost: 1, previousCreated: 8 },
    calls: { placed: 10, connected: 6, averageSeconds: 84 },
    whatsapp: { sent: 20, replied: 9 },
    campaigns: { active: 2, spendPaise: 240_000, leads: 8, previousCplPaise: 28_000 },
    content: { published: 3, created: 3 },
    credits: { balance: 4_000, spentLast7Days: 700 },
    routines: { ran: 3, failed: 0 },
  };
  return [
    { name: 'a healthy day', metrics: base },
    {
      name: 'ads spending with no enquiries',
      metrics: { ...base, campaigns: { active: 1, spendPaise: 480_000, leads: 0, previousCplPaise: 30_000 } },
    },
    {
      name: 'each enquiry costing more',
      metrics: { ...base, campaigns: { active: 1, spendPaise: 480_000, leads: 6, previousCplPaise: 30_000 } },
    },
    {
      // Seen in production: the same 37 leads reported under five different Meta ids, and a 7-day ad
      // figure compared against a one-day lead count. Both halves are now the same seven days.
      name: 'ads claiming more enquiries than arrived',
      metrics: {
        ...base,
        leads: { created: 2, contacted: 2, replied: 1, booked: 0, lost: 0, previousCreated: 3, last7Days: 8 },
        campaigns: { active: 1, spendPaise: 43_400, leads: 37, previousCplPaise: 2_300 },
      },
    },
    {
      // The same account, healthy: 37 ad enquiries and 34 leads in the same week is a rounding gap,
      // not a catastrophe, and must NOT raise anything.
      name: 'ads and the list agree',
      metrics: {
        ...base,
        leads: { created: 5, contacted: 4, replied: 2, booked: 1, lost: 0, previousCreated: 4, last7Days: 34 },
        campaigns: { active: 1, spendPaise: 43_400, leads: 37, previousCplPaise: 2_300 },
      },
    },
    {
      name: 'nobody contacted anyone',
      metrics: { ...base, leads: { created: 9, contacted: 0, replied: 0, booked: 0, lost: 0, previousCreated: 4 } },
    },
    {
      name: 'some people still waiting',
      metrics: { ...base, leads: { created: 9, contacted: 6, replied: 2, booked: 0, lost: 0, previousCreated: 5 } },
    },
    { name: 'calls nobody answered', metrics: { ...base, calls: { placed: 12, connected: 0 } } },
    { name: 'calls mostly answered', metrics: { ...base, calls: { placed: 10, connected: 8, averageSeconds: 121 } } },
    { name: 'credits nearly gone', metrics: { ...base, credits: { balance: 900, spentLast7Days: 2_100 } } },
    { name: 'the daily job failed', metrics: { ...base, routines: { ran: 4, failed: 2 } } },
    {
      name: 'the daily job never ran',
      metrics: {
        ...base,
        leads: { created: 0, contacted: 0, replied: 0, booked: 0, lost: 0 },
        campaigns: { active: 0, spendPaise: 0, leads: 0 },
        content: { published: 0, created: 0 },
        routines: { ran: 0, failed: 0 },
      },
    },
    { name: 'content made but not published', metrics: { ...base, content: { published: 0, created: 3 } } },
    { name: 'whatsapp getting replies', metrics: { ...base, whatsapp: { sent: 10, replied: 6 } } },
    {
      name: 'a genuinely quiet day',
      metrics: {
        ...base,
        leads: { created: 0, contacted: 0, replied: 0, booked: 0, lost: 0, previousCreated: 0 },
        calls: { placed: 0, connected: 0 },
        whatsapp: { sent: 0, replied: 0 },
        campaigns: { active: 0, spendPaise: 0, leads: 0 },
        content: { published: 0, created: 0 },
        credits: { balance: 3_000, spentLast7Days: 0 },
        routines: { ran: 1, failed: 0 },
      },
    },
  ];
}

const allFindings: { scenario: string; finding: Finding }[] = [];
for (const scenario of scenarios()) {
  for (const finding of analyseDay(scenario.metrics)) allFindings.push({ scenario: scenario.name, finding });
}

head('1. Every sentence a business owner will read, in every situation');

check('every scenario produces at least one finding', scenarios().every((s) => analyseDay(s.metrics).length > 0), `${allFindings.length} findings across ${scenarios().length} situations`);

for (const { pattern, why } of BANNED) {
  const hits = allFindings
    .filter(({ finding }) =>
      pattern.test(
        `${finding.title} ${finding.evidence} ${finding.recommendation} ${summariseFindings([finding])}`,
      ),
    )
    .map(({ scenario, finding }) => `${scenario}: "${finding.title}"`);
  check(`no jargon: ${pattern.source} (${why})`, hits.length === 0, hits.slice(0, 3).join(' | '));
}

head('2. A number is never left on its own');

{
  // The mismatch that produced a fake catastrophe in production: a seven-day ad figure against a
  // one-day lead count. It must not speak unless both halves cover the same week.
  const gapBase: DayMetrics = {
    window: { from: '2026-02-01', to: '2026-02-02' },
    leads: { created: 2, contacted: 2, replied: 1, booked: 0, lost: 0, previousCreated: 3 },
    calls: { placed: 0, connected: 0 },
    whatsapp: { sent: 0, replied: 0 },
    campaigns: { active: 1, spendPaise: 324_031, leads: 37, previousCplPaise: null },
    content: { published: 1, created: 1 },
    credits: { balance: 24_792, spentLast7Days: 0 },
    routines: { ran: 1, failed: 0 },
  };
  const mismatched = analyseDay(gapBase);
  check(
    'with no seven-day lead count it stays silent instead of comparing unlike windows',
    !mismatched.some((finding) => finding.id === 'ads-vs-list-gap'),
    mismatched.map((finding) => finding.id).join(', ') || 'silent',
  );
  const matched = analyseDay({ ...gapBase, leads: { ...gapBase.leads, last7Days: 34 } });
  check(
    'and 37 ad enquiries against 34 leads in the same week is not a catastrophe',
    !matched.some((finding) => finding.id === 'ads-vs-list-gap'),
    matched.map((finding) => finding.id).join(', ') || 'silent',
  );
  const realGap = analyseDay({ ...gapBase, leads: { ...gapBase.leads, last7Days: 8 } });
  check(
    'but 37 against 8 in the same week IS raised',
    realGap.some((finding) => finding.id === 'ads-vs-list-gap'),
    realGap.find((finding) => finding.id === 'ads-vs-list-gap')?.title ?? 'not raised',
  );

  // Where the report HAS a previous figure to compare against, the sentence must use it. This is
  // the difference between a report and a dashboard: a dashboard shows 12, a report says 12 and
  // what that means.
  const comparable = allFindings.filter(({ finding }) => ['cpl-rising', 'quiet-day'].includes(finding.id));
  check(
    'the comparisons that have data actually compare',
    comparable.every(({ finding }) => /week before|same as|more than|fewer than|down from|up from/i.test(finding.evidence)),
    comparable.map(({ finding }) => finding.evidence.slice(0, 70)).join(' | ') || 'no comparable finding produced',
  );

  const offenders = allFindings
    .filter(({ finding }) => !(/\d/.test(finding.evidence) && finding.evidence.length > 25))
    .map(({ scenario, finding }) => `${scenario}: "${finding.evidence}"`);
  check(
    'every finding carries a number and a sentence around it',
    offenders.length === 0,
    offenders.slice(0, 3).join(' | '),
  );
}

head('3. Every finding ends in something a person can say yes to');

{
  check(
    'no recommendation is a stub',
    allFindings.every(({ finding }) => finding.recommendation.trim().length > 25),
    `shortest: ${Math.min(...allFindings.map(({ finding }) => finding.recommendation.length))} chars`,
  );
  check(
    'nothing reads like a machine announcing itself',
    allFindings.every(({ finding }) =>
      !/\b(successfully|great|excited|delighted|leverage|seamless|robust|utilise|utilize)\b/i.test(
        `${finding.title} ${finding.evidence} ${finding.recommendation}`,
      ),
    ),
  );
  check(
    'no past-tense claims of actions the report never took',
    allFindings.every(({ finding }) =>
      !/\bI (have )?(paused|launched|spent|sent|deleted|changed|pushed|published)\b/i.test(finding.recommendation),
    ),
  );
  check(
    'percentages are written as "x in 10" a person can picture',
    allFindings.every(({ finding }) => !/\d+\s?%/.test(`${finding.title} ${finding.evidence}`)),
  );
}

head('4. The page chrome, not just the findings');

{
  /**
   * Comments are stripped before scanning. The ban is about what an owner SEES on the screen; a
   * source comment explaining the old name ("Daily engine was the internal name for this") is
   * documentation, not copy, and failing on it would push the reasoning out of the file.
   */
  const codeOnly = (source: string) =>
    source
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  const panel = codeOnly(fs.readFileSync('app/dashboard/ceo/CeoToday.tsx', 'utf8'));
  const card = codeOnly(fs.readFileSync('components/agent/CeoFindingsCard.tsx', 'utf8'));

  check('the daily job is called what it is', /Your daily marketing/.test(panel) && !/>Daily engine</.test(panel));
  check('"how often" replaces "cadence" in the interface', /How often/.test(panel) && !/>Cadence</.test(panel));
  check('"spent today" replaces "spend today"', /Spent today/.test(panel));
  check(
    'the findings card is titled in plain words',
    /What happened yesterday/.test(card) && !/Yesterday, in findings/.test(card),
  );
  check('the suggestion is labelled as mine, in the first person', /What I would do/.test(card) && !/We suggest/.test(card));

  // The internal name must not survive anywhere an owner can see it.
  const ownerFacing = [panel, card].join('\n');
  for (const word of ['Daily engine', 'Cadence', 'routine(s)']) {
    check(`"${word}" is gone from the owner's screen`, !ownerFacing.includes(word));
  }
}

head('5. The same text, rendered as the email');

{
  const report = renderReport(scenarios()[1].metrics, analyseDay(scenarios()[1].metrics));
  for (const { pattern, why } of BANNED) {
    check(`the email edition has no jargon: ${pattern.source}`, !pattern.test(report), why);
  }
  check('the email says what the numbers were', /the numbers:/.test(report));
  check('the email says what would be done', /what I would do:/.test(report));
  check('the email asks before acting', /I will ask you first/.test(report));
  check('the email does not open with a compliment', !/^What happened[\s\S]{0,80}\bgood news\b/i.test(report));
}

console.log(`\n${'='.repeat(64)}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nThe report has to be readable by the person paying for it. Fix the copy, not the check.');
  process.exit(1);
}
console.log('A business owner can read every line of this report without a glossary.');
