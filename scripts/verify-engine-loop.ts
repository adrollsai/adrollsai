/**
 * Proves the daily job is driven by last week's numbers, and that it fails loudly rather than
 * quietly.
 *
 * THE FAILURE THIS PINS
 * Every piece of the learning loop existed and none of it was connected. `lastWeekNotes` and
 * `creativeLearnings` were both parameters of `composeRoutineBrief` with no caller, so the brief
 * printed "WHAT THE ADS HAVE ACTUALLY DONE: not read yet" every single morning and the business
 * never learned anything across days. The ad-spend figures were null in the metrics reader, and
 * `?? 0` turned "we cannot see Meta" into "you spent nothing". All of it type-checked, all of it
 * passed every existing gate, and none of it worked.
 *
 * A gate cannot measure "the business improved". What it CAN do is prove the inputs that make
 * improvement possible are present and connected on every run — and that their absence is stated
 * instead of rendered as a zero. That is what this does:
 *
 *   1. THE BRIEF CARRIES LAST WEEK, and the block disappears honestly when there is no data.
 *   2. THE BRIEF CARRIES MEASURED VERDICTS when they exist, and asks for them when they do not.
 *   3. THE WEEK IS COMPUTED from a reader, compared against the week before, and a reader that
 *      fails produces a shorter true sentence — never a confident zero.
 *   4. UNREADABLE AD MONEY IS NAMED as missing, so no report can imply "you spent nothing".
 *   5. THE WIRING IS PRESENT in the routine, so it cannot be deleted without failing here.
 *
 *   npm run verify:engine-loop
 */
import fs from 'node:fs';
import { composeRoutineBrief, type RoutineBriefInput } from '../lib/automation/routine-composer';
import { weekRecap, weekWindow } from '../lib/agent/weekly-recap';
import { gatherDayMetrics, windowFor, type MetricsReader } from '../lib/agent/ceo-metrics';
import { costPerResultPaise } from '../lib/ads/account-performance';
import type { CreativeLearnings } from '../lib/ads/creative-learning';

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

const NOW = new Date('2026-11-24T04:00:00.000Z'); // 09:30 IST

function baseBrief(overrides: Partial<RoutineBriefInput> = {}): RoutineBriefInput {
  return {
    businessName: 'Procolor Film Academy',
    industry: 'education',
    playbook: null,
    routine: {
      name: 'Daily marketing',
      intent: 'Grow the academy.',
      cadence: 'daily',
      approval_policy: 'always',
      daily_credit_cap: 200,
      channels: ['whatsapp'],
      timezone: 'Asia/Kolkata',
    },
    todaysDate: '2026-11-24',
    now: NOW,
    creditsLeft: 7_879,
    availableCredits: 7_879,
    pendingApprovals: 0,
    festivals: [],
    ...overrides,
  };
}

/** A reader that answers with the given numbers. */
function reader(overrides: Partial<Record<keyof MetricsReader, any>> = {}): MetricsReader {
  return {
    async leadsInWindow() {
      return { created: 12, contacted: 9, replied: 5, booked: 2, lost: 1, previousCreated: 8 };
    },
    async callsInWindow() {
      return { placed: 40, connected: 18, averageSeconds: 74 };
    },
    async whatsappInWindow() {
      return { sent: 30, replied: 11 };
    },
    async postsInWindow() {
      return { published: 3, created: 3 };
    },
    async routinesInWindow() {
      return { ran: 7, failed: 0 };
    },
    async wallet() {
      return { balance: 7_879, spentLast7Days: 420 };
    },
    async ads() {
      return { active: 2, spendPaise: 482_000, leads: 6, previousCplPaise: 31_000 };
    },
    ...(overrides as any),
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
head('1. Last week reaches the brief');

{
  const withWeek = composeRoutineBrief(
    baseBrief({
      lastWeekNotes:
        'Last week (17 Nov to 23 Nov): 12, up from 8 new enquiries. Ads cost ₹4,820 and brought 6 of those ' +
        'enquiries — ₹803 each, up from ₹310 — dearer than the week before.',
    })
  ).text;

  check('the brief has a LAST WEEK section', /LAST WEEK, MEASURED/.test(withWeek));
  check(
    'it carries the measured sentence, not a placeholder',
    /12, up from 8 new enquiries/.test(withWeek) && /₹803 each/.test(withWeek),
    withWeek.split('\n').find((line) => line.includes('Last week ('))?.slice(0, 80) ?? 'missing'
  );
  check(
    'and it forces today to answer a number that moved the wrong way',
    /today's plan has to answer it by name/.test(withWeek),
  );

  const withoutWeek = composeRoutineBrief(baseBrief()).text;
  check(
    'with no week supplied the block is absent rather than empty or invented',
    !/LAST WEEK, MEASURED/.test(withoutWeek) && !/undefined|null/.test(withoutWeek),
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
head('2. Measured verdicts reach the brief');

{
  const learnings: CreativeLearnings = {
    period: 'last_7d',
    currency: 'INR',
    observed: 5,
    unattributedRows: 1,
    unattributedSpend: 400,
    angles: [
      {
        angleId: 'proof',
        label: 'Proof',
        spend: 3_000,
        impressions: 42_000,
        results: 9,
        samples: 2,
        costPerResult: 333,
        ctr: 1.8,
        verdict: 'winning',
        reason: 'Cost per result 333 INR — the best of everything that ran.',
      },
      {
        angleId: 'discount',
        label: 'Discount',
        spend: 1_800,
        impressions: 30_000,
        results: 1,
        samples: 1,
        costPerResult: 1_800,
        ctr: 0.7,
        verdict: 'losing',
        reason: 'Cost per result 1800 INR, more than 50% worse than the best.',
      },
    ],
    winners: ['proof'],
    losers: ['discount'],
    tooEarly: [],
    summary: 'Winning: Proof (best 333 INR per result). Losing: Discount.',
  };

  const withLearnings = composeRoutineBrief(baseBrief({ creativeLearnings: learnings })).text;
  check('the brief states what the ads actually did', /WHAT THE ADS HAVE ACTUALLY DONE \(measured, not guessed/.test(withLearnings));
  check('it names the winner', /Make more like: proof/.test(withLearnings), 'winner carried into the plan');
  check('it names the loser and tells it not to repeat it', /Do not simply repeat: discount/.test(withLearnings));
  check('it does NOT fall back to "not read yet" when data exists', !/not read yet/.test(withLearnings));

  const withoutLearnings = composeRoutineBrief(baseBrief()).text;
  check(
    'with nothing measured it says so and sends the agent to read the numbers',
    /WHAT THE ADS HAVE ACTUALLY DONE: not read yet/.test(withoutLearnings) &&
      /Call optimize_meta_campaign BEFORE designing anything/.test(withoutLearnings),
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
head('3. The week is computed, compared, and honest when blind');

{
  const window = weekWindow(NOW, 'Asia/Kolkata');
  const spanDays = (Date.parse(window.to) - Date.parse(window.from)) / 86_400_000;
  check('the week window is seven days', Math.round(spanDays) === 7, `${spanDays} days`);
  check(
    'and the week before is the seven days before that',
    window.previousTo === window.from &&
      Math.round((Date.parse(window.to) - Date.parse(window.previousFrom)) / 86_400_000) === 14,
  );

  const recap = await weekRecap(reader(), NOW, 'Asia/Kolkata');
  check('it counts the enquiries and compares with the week before', /12, up from 8 new enquiries/.test(recap.text), recap.text.slice(0, 90));
  check('it prices the enquiries from ad money', /₹4,820/.test(recap.text) && /₹803 each/.test(recap.text));
  check('it says which way the price moved', /up from ₹310/.test(recap.text) && /dearer/.test(recap.text));
  check('it reports bookings in plain words', /2 of the enquiries turned into a booking/.test(recap.text));
  check('it reports the calls that were answered', /40 calls and 18 were answered/.test(recap.text));
  check('no jargon survives in the recap', !/\b(CPL|CTR|leads?|impressions|attribution)\b/i.test(recap.text), recap.text);
  check('nothing is missing when everything reads', recap.missing.length === 0, recap.missing.join(', '));

  // Ads spending and buying nothing: the sentence has to say that, not show a zero price.
  const noResults = await weekRecap(
    reader({
      ads: async () => ({ active: 1, spendPaise: 250_000, leads: 0, previousCplPaise: null }),
    }),
    NOW,
    'Asia/Kolkata'
  );
  check('spending with no enquiries is stated plainly', /brought no enquiries at all/.test(noResults.text), noResults.text.slice(0, 90));

  // Meta unreadable: absence, not zero.
  const blind = await weekRecap(
    reader({ ads: async () => ({ active: 0, spendPaise: null, leads: null, previousCplPaise: null }) }),
    NOW,
    'Asia/Kolkata'
  );
  check(
    'unreadable ad money is named as unknown, not reported as ₹0',
    /could not be read/.test(blind.text) && /unknown, not zero/.test(blind.text) && blind.missing.includes('ad money'),
    blind.text.slice(0, 100)
  );

  // A section that throws shortens the sentence instead of inventing a figure.
  const angry = await weekRecap(
    reader({
      callsInWindow: async () => {
        throw new Error('table unavailable');
      },
    }),
    NOW,
    'Asia/Kolkata'
  );
  check('a section that fails is named, and the rest still reports', angry.missing.includes('calls') && /new enquiries/.test(angry.text), angry.missing.join(', '));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
head('4. The report can see the money, and says when it cannot');

{
  // Units. Meta reports spend in the account's currency; every figure the report compares must be
  // in paise, or "₹44 each, against ₹0" makes every week look like a price rise.
  check(
    'a price per result is derived in paise, not rupees',
    costPerResultPaise(4_820, 6) === 80_333,
    `${costPerResultPaise(4_820, 6)} paise for ₹4,820 across 6 enquiries`
  );
  check('no results means no price, never a division by zero', costPerResultPaise(4_820, 0) === null);
  check(
    'two weeks priced from the same unit compare correctly',
    (() => {
      const now = costPerResultPaise(4_820, 6) as number;
      const before = costPerResultPaise(3_100, 10) as number;
      return now > before && now / before > 2;
    })(),
    'the dearer week is the dearer number'
  );

  const withMeta = await gatherDayMetrics(reader(), windowFor(NOW));
  check(
    'ad spend reaches the report',
    withMeta.metrics.campaigns.spendPaise === 482_000 && withMeta.metrics.campaigns.leads === 6,
    `₹${withMeta.metrics.campaigns.spendPaise / 100} / ${withMeta.metrics.campaigns.leads} enquiries`
  );
  check('and the week before is available for comparison', withMeta.metrics.campaigns.previousCplPaise === 31_000);

  const blind = await gatherDayMetrics(
    reader({ ads: async () => ({ active: 3, spendPaise: null, leads: null, previousCplPaise: null }) }),
    windowFor(NOW)
  );
  check(
    'unreadable ad money is reported as missing, not as zero spend',
    blind.missing.includes('ads'),
    `missing: ${blind.missing.join(', ') || 'nothing'}`
  );
  check('and the active campaign count still survives', blind.metrics.campaigns.active === 3);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
head('5. The wiring cannot be deleted quietly');

{
  const routines = fs.readFileSync('lib/agent/routines.ts', 'utf8');
  check('the routine reads measured performance before composing', /loadAccountPerformance\(/.test(routines));
  check('the routine computes last week before composing', /weekRecap\(/.test(routines));
  check('both are passed into the brief', /lastWeekNotes:/.test(routines) && /creativeLearnings:/.test(routines));
  check(
    'neither can block the day: both are wrapped against failure',
    /loadAccountPerformance[\s\S]{0,200}\.catch\(/.test(routines) && /weekRecap[\s\S]{0,120}\.catch\(/.test(routines),
  );

  const metrics = fs.readFileSync('lib/agent/ceo-metrics.ts', 'utf8');
  check('the report reads ad money from Meta', /loadAccountPerformance/.test(metrics));
  check('and marks it missing when Meta cannot answer', /missing\.push\('ads'\)/.test(metrics));

  const composer = fs.readFileSync('lib/automation/routine-composer.ts', 'utf8');
  check(
    'the composer still demands plain words in the digest the owner reads',
    /Never use an acronym/.test(composer) && /Every number gets a comparison/.test(composer),
  );
}

console.log(`\n${'='.repeat(64)}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nThe loop is not closed. A daily job that cannot read last week cannot improve on it.');
  process.exit(1);
}
console.log('Every run starts from measured numbers, and says so when it cannot.');
