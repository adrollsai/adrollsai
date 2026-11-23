/**
 * Proves the performance loop is honest, deterministic, and cannot overrule a person.
 *
 * WHY THIS GATE IS MOSTLY ABOUT WHAT THE LOOP REFUSES
 * A learning loop that reports confidently from thin data is worse than no loop: it launders noise into a
 * budget decision, and the owner cannot tell the difference. So most of what follows asserts the bounds —
 * it will not call an angle on 300 impressions, it will not hide spend it could not attribute, and a
 * measurement can never make the compiler invent a fact it was not given.
 *
 * The other half pins the wiring that has already broken once in this area: `meta_graph_insights` formats
 * its display rows into "₹2,000.00" and "1.25%" and drops the ids, and `recommendOptimisation` reads
 * `row.spend` and `row.adset_id`. Handed the display rows it computed NaN against every threshold and
 * answered "nothing has crossed the spend threshold" no matter what the account was doing. A judgement
 * tool that can never judge passes every test that only checks it does not throw.
 *
 *   npm run verify:creative-learning
 */
import {
  MIN_IMPRESSIONS_FOR_JUDGEMENT,
  MIN_SPEND_FOR_JUDGEMENT,
  angleGuidance,
  attributePerformance,
  deriveResults,
  learningsBriefLines,
  normalisePerformanceRow,
  parseNumber,
  summariseLearnings,
  type AttributedObservation,
  type LaunchedCreative,
} from '../lib/ads/creative-learning';
import { AD_ANGLES, chooseAngle } from '../lib/agent/creative/ad-prompt-compiler';
import {
  buildCampaignJobPayload,
  loadRecordedLaunches,
  normaliseCreativePlan,
  recommendOptimisation,
} from '../lib/ads/launch-service';
import { composeRoutineBrief } from '../lib/automation/routine-composer';

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

head('1. The numbers survive the trip out of the provider');

check('formatted money parses to a number', parseNumber('₹2,000.50') === 2000.5, '₹2,000.50');
check('a formatted percent parses to a number', parseNumber('1.25%') === 1.25, '1.25%');
check('a thousands separator is not a decimal point', parseNumber('1,234.56') === 1234.56, '1,234.56');
check('a real number passes through', parseNumber(42) === 42 && parseNumber(0) === 0, '42, 0');
check('nothing useful yields null rather than NaN', parseNumber(null) === null && parseNumber('—') === null, 'null, not NaN');
check(
  'NaN is never produced, because NaN compares false against every threshold and silently disables judgement',
  [parseNumber('₹1,00,000'), parseNumber(''), parseNumber(undefined)].every((value) => value === null || Number.isFinite(value)),
  'finite or null',
);

head('2. A result means what the campaign meant');

check(
  'an explicit results/leads field wins',
  deriveResults({ results: 7, actions: [{ action_type: 'lead', value: '3' }] }) === 7,
  'explicit wins',
);
check(
  'a lead action is counted',
  deriveResults({ actions: [{ action_type: 'lead', value: '5' }] }) === 5,
  'lead',
);
check(
  'a WhatsApp conversation start counts as a result',
  deriveResults({ actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '9' }] }) === 9,
  'messaging',
);
check(
  'impressions and reach are NOT mistaken for results',
  deriveResults({ actions: [{ action_type: 'post_engagement', value: '400' }] }) === 0,
  'zero, not 400',
);
check(
  'spend with no result reads as 0, not unknown — it is the most actionable finding there is',
  deriveResults({}) === 0,
  'zero',
);

head('3. Attribution joins a launch to its numbers, and admits what it cannot join');

const rows = [
  // ad-level id, attributed through the ad
  { ad_id: 'ad-1', adset_id: 'set-1', campaign_id: 'c-1', spend: '1000', impressions: '20000', clicks: '300', ctr: '1.50%', actions: [{ action_type: 'lead', value: '10' }] },
  // no ad id: falls back to the ad set
  { adset_id: 'set-2', campaign_id: 'c-2', spend: '800', impressions: '15000', clicks: '90', actions: [{ action_type: 'lead', value: '2' }] },
  // only a campaign id
  { campaign_id: 'c-3', spend: '600', impressions: '12000', clicks: '60', actions: [{ action_type: 'lead', value: '1' }] },
  // nothing we ever launched
  { campaign_id: 'c-unknown', spend: '500', impressions: '9000', clicks: '10', actions: [] },
  // no id at all: cannot be attributed to anything
  { spend: '250', impressions: '1000', clicks: '5' },
];
const launchedCreative: LaunchedCreative[] = [
  { campaignId: 'c-1', adId: 'ad-1', angleId: 'proof' },
  { campaignId: 'c-2', adsetId: 'set-2', angleId: 'offer-first' },
  { campaignId: 'c-3', angleId: 'local' },
  // a plan with no angle teaches nothing and must be ignored
  { campaignId: 'c-unknown', angleId: null },
];

const attributed = attributePerformance(rows as any, launchedCreative);
check(
  'an ad-level match beats the ad set and the campaign',
  attributed.observations.some((row) => row.adId === 'ad-1' && row.angleId === 'proof'),
  'ad → proof',
);
check(
  'an ad set match is used when there is no ad id',
  attributed.observations.some((row) => row.adsetId === 'set-2' && row.angleId === 'offer-first'),
  'adset → offer-first',
);
check(
  'a campaign match is used when that is all the launch recorded',
  attributed.observations.some((row) => row.campaignId === 'c-3' && row.angleId === 'local'),
  'campaign → local',
);
check(
  'spend that cannot be attributed is counted, not dropped',
  attributed.unattributedRows === 2 && attributed.unattributedSpend === 750,
  `${attributed.unattributedRows} rows, ${attributed.unattributedSpend} spend`,
);
check(
  'only attributed rows reach the summary',
  attributed.observations.length === 3,
  `${attributed.observations.length} observations`,
);
check(
  'a row with no id at all is refused rather than guessed',
  normalisePerformanceRow({ spend: '100', impressions: '50' } as any) === null,
  'null',
);

head('4. It will not learn from noise');

const noisy: AttributedObservation[] = [
  // 300 impressions and ₹200: nowhere near enough to have an opinion
  { campaignId: 'c', adsetId: null, adId: null, angleId: 'curiosity', spend: 200, impressions: 300, clicks: 2, results: 0, ctr: 0.6 },
];
const noiseLearnings = summariseLearnings(noisy);
check(
  'a thin angle is "too_early", never "losing"',
  noiseLearnings.angles[0]?.verdict === 'too_early',
  noiseLearnings.angles[0]?.verdict,
);
check(
  'and it says why, quoting the bar it missed',
  /below the/.test(noiseLearnings.angles[0]?.reason || '') &&
    noiseLearnings.angles[0].reason.includes(String(MIN_IMPRESSIONS_FOR_JUDGEMENT)),
  noiseLearnings.angles[0]?.reason.slice(0, 80),
);
check(
  'nothing is recommended from noise',
  angleGuidance(noiseLearnings).prefer.length === 0 && angleGuidance(noiseLearnings).avoid.length === 0,
  'no guidance',
);
check(
  'impressions alone are not enough — spend must clear its own bar',
  summariseLearnings([{ ...noisy[0], impressions: 50000, spend: MIN_SPEND_FOR_JUDGEMENT - 1 }]).angles[0].verdict ===
    'too_early',
  'spend gate',
);

head('5. Verdicts: cheapest wins, nothing-for-money loses, 1.5x off loses');

const judged: AttributedObservation[] = [
  // 1000/11 = 91 per result — within 15% of the best, so it counts as winning too
  { campaignId: 'c1', adsetId: null, adId: null, angleId: 'proof', spend: 1000, impressions: 20000, clicks: 400, results: 11, ctr: 2 },
  // 1000/12 = 83 per result — the best of the field
  { campaignId: 'c2', adsetId: null, adId: null, angleId: 'offer-first', spend: 1000, impressions: 20000, clicks: 300, results: 12, ctr: 1.5 },
  // 2000 spent, nothing produced — the clearest possible loss
  { campaignId: 'c3', adsetId: null, adId: null, angleId: 'authority', spend: 2000, impressions: 30000, clicks: 90, results: 0, ctr: 0.3 },
  // 1500/2 = 750 per result — nine times the best, far outside the band
  { campaignId: 'c4', adsetId: null, adId: null, angleId: 'transformation', spend: 1500, impressions: 25000, clicks: 100, results: 2, ctr: 0.4 },
];
const learnings = summariseLearnings(judged);
const verdict = (angleId: string) => learnings.angles.find((angle) => angle.angleId === angleId)?.verdict;

check('the cheapest cost per result wins', verdict('offer-first') === 'winning', `${verdict('offer-first')} — 83/result beats 91/result`);
check(
  'a close second is also winning, because 15% is measurement noise',
  verdict('proof') === 'winning',
  `${verdict('proof')} — 91/result is within 15% of 83`,
);
check('spending with zero results is losing', verdict('authority') === 'losing', verdict('authority'));
check('more than 1.5x the best cost is losing', verdict('transformation') === 'losing', verdict('transformation'));
check(
  'cost per result is computed, not estimated',
  Math.round((learnings.angles.find((angle) => angle.angleId === 'offer-first')?.costPerResult ?? 0) * 100) / 100 ===
    Math.round((1000 / 12) * 100) / 100,
  String(learnings.angles.find((angle) => angle.angleId === 'offer-first')?.costPerResult),
);
check(
  'winners come back best-first and losers are listed',
  learnings.winners.length === 2 && learnings.winners[0] === 'offer-first' && learnings.losers.length === 2,
  `winners ${learnings.winners.join(',')} / losers ${learnings.losers.join(',')}`,
);
check('the summary is a sentence, not a data dump', /Winning:/.test(learnings.summary) && /Losing:/.test(learnings.summary), learnings.summary.slice(0, 90));

head('6. Same numbers in, same learnings out — which is why nothing needs caching');

const first = JSON.stringify(summariseLearnings(judged));
const second = JSON.stringify(summariseLearnings(judged));
check('two runs on the same input are byte-identical', first === second, 'deterministic');
check(
  'and order does not depend on the order rows arrived in',
  JSON.stringify(summariseLearnings([...judged].reverse())) === first,
  'order-independent',
);

head('7. Guidance is advice, and it never outranks a person');

const guidance = angleGuidance(learnings);
check('the winning angles are proposed', guidance.prefer.length === 2 && guidance.prefer[0].angleId === 'offer-first', guidance.prefer.map((p) => p.angleId).join(','));
check('the losing angles are offered for exclusion', guidance.avoid.length === 2, guidance.avoid.map((a) => a.angleId).join(','));
check(
  'each item carries its measurement, so it can be argued with',
  guidance.avoid.every((item) => item.reason.length > 20),
  'reasons present',
);
check(
  'the note says the owner wins',
  /owner/i.test(guidance.note) && /instruction/i.test(guidance.note),
  guidance.note.slice(0, 80),
);
check(
  'no learnings at all is a valid answer, not an error',
  angleGuidance(null).prefer.length === 0 && angleGuidance(null).avoid.length === 0 && angleGuidance(null).note.length > 0,
  'safe empty',
);

head('8. A measurement cannot make the compiler invent a fact');

// The only fact supplied is `offer`, so only an angle requiring `offer` alone is honest here.
const honestBrief = {
  product: 'Cinematography diploma',
  offer: '₹15,000 off',
  place: 'Chandigarh',
  facts: {},
  industry: 'education',
};
check(
  'with no preference, the angle whose facts are supplied is chosen',
  chooseAngle({ ...honestBrief }).angle.id === 'offer-first',
  chooseAngle({ ...honestBrief }).angle.id,
);
check(
  'preferring an angle whose facts are MISSING does not win — honesty outranks performance',
  chooseAngle({ ...honestBrief, prefer: ['scarcity-deadline'] }).angle.id === 'offer-first',
  chooseAngle({ ...honestBrief, prefer: ['scarcity-deadline'] }).angle.id,
);
check(
  'preference only reorders among angles that are equally supported',
  (() => {
    // Both of these require `offer` alone to be honest is not guaranteed, so assert the general property:
    // adding a preference must never reduce the number of unsatisfied requirements in the result.
    const withoutPreferred = chooseAngle({ ...honestBrief });
    const withPreferred = chooseAngle({ ...honestBrief, prefer: [AD_ANGLES[0].id] });
    const missingOf = (id: string) => AD_ANGLES.find((a) => a.id === id)?.requires.length ?? 0;
    return missingOf(withPreferred.angle.id) <= missingOf(withoutPreferred.angle.id) + 0 && withPreferred.angle.id === AD_ANGLES[0].id;
  })(),
  'no downgrade',
);
check(
  'a preferred angle that IS supported is chosen',
  chooseAngle({ ...honestBrief, facts: { deadline: '30 November' }, prefer: ['scarcity-deadline'] }).angle.id ===
    'scarcity-deadline',
  chooseAngle({ ...honestBrief, facts: { deadline: '30 November' }, prefer: ['scarcity-deadline'] }).angle.id,
);
check(
  'an excluded angle is never chosen, whichever list it came from',
  ['proof'].every((id) => chooseAngle({ ...honestBrief, avoid: [id] }).angle.id !== id),
  'avoid honoured',
);

head('9. The launch records what it argued, and the payload stays inert');

check(
  'a plan is normalised and kept',
  normaliseCreativePlan({ angleId: 'proof', headline: 'Sites open Saturday' })?.angleId === 'proof',
  'kept',
);
check(
  'a plan with no angle is dropped, because it could never teach anything',
  normaliseCreativePlan({ headline: 'Sites open Saturday' }) === null,
  'dropped',
);
check(
  'a runaway string is clipped rather than stored forever',
  (normaliseCreativePlan({ angleId: 'proof', headline: 'x'.repeat(5000) })?.headline || '').length === 200,
  'clipped to 200',
);
check(
  'junk is refused',
  normaliseCreativePlan('not a plan') === null && normaliseCreativePlan(null) === null,
  'null',
);

const payload: any = buildCampaignJobPayload(
  { token: 't', adAccountId: 'a', pageId: 'p', businessName: 'Procolor', currency: 'INR', userId: 'u' } as any,
  { dailyBudget: 500, campaignType: 'whatsapp_chat', creativePlan: { angleId: 'proof', headline: 'Sites open Saturday' } } as any,
  {} as any,
);
check(
  'the payload carries the creative plan for the next pass to read',
  payload.creativePlan?.angleId === 'proof',
  payload.creativePlan?.angleId,
);
check(
  'every other payload key is untouched, so the processor is unaffected',
  payload.adCopy !== undefined && payload.dailyBudget === 500 && payload.businessName === 'Procolor',
  'inert extra key',
);
check(
  'a launch with no plan stores null rather than an empty shell',
  buildCampaignJobPayload(
    { token: 't', adAccountId: 'a', pageId: 'p', businessName: 'B', currency: 'INR', userId: 'u' } as any,
    { dailyBudget: 500 } as any,
    {} as any,
  ).creativePlan === null,
  'null',
);

head('10. Reading launches degrades safely instead of throwing');

const noTable = {
  from: () => ({
    select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: null, error: { message: 'relation does not exist' } }) }) }) }),
  }),
};
const missing = await loadRecordedLaunches(noTable as any, 'user-1');
check(
  'a missing table reports an error and zero launches, rather than failing the pass',
  missing.launches.length === 0 && Boolean(missing.readError),
  missing.readError,
);
const thrower = {
  from: () => {
    throw new Error('network down');
  },
};
const threw = await loadRecordedLaunches(thrower as any, 'user-1');
check('a thrown read is caught', threw.launches.length === 0 && Boolean(threw.readError), threw.readError);

const withRows = {
  from: () => ({
    select: () => ({
      eq: () => ({
        order: () => ({
          limit: async () => ({
            data: [
              { campaign_id: 'c-1', payload: { creativePlan: { angleId: 'proof' } }, created_at: 'now' },
              { campaign_id: 'c-2', payload: { creativePlan: null }, created_at: 'now' },
              { campaign_id: null, payload: {}, created_at: 'now' },
            ],
            error: null,
          }),
        }),
      }),
    }),
  }),
};
const recorded = await loadRecordedLaunches(withRows as any, 'user-1');
check(
  'only launches that recorded an angle are returned',
  recorded.launches.length === 1 && recorded.launches[0].angleId === 'proof' && recorded.launches[0].campaignId === 'c-1',
  `${recorded.launches.length} launch(es)`,
);

head('11. Both flows are told, and neither claims to know what it has not read');

check(
  'the brief says to read performance before designing when it has no data',
  /not read yet/.test(composeRoutineBrief({ routine: { timezone: 'Asia/Kolkata', intent: 'post' }, todaysDate: '2026-11-25' } as any).text),
  'asks rather than assumes',
);
check(
  'the brief carries the measured verdicts when it has them',
  (() => {
    const text = composeRoutineBrief({
      routine: { timezone: 'Asia/Kolkata', intent: 'post' },
      todaysDate: '2026-11-25',
      creativeLearnings: learnings,
    } as any).text;
    return /measured, not guessed/.test(text) && /Winning:/.test(text) && /avoidAngles/.test(text);
  })(),
  'measured verdicts present',
);
check(
  'the brief names the winning angle so the day is built on it',
  (() => {
    const text = composeRoutineBrief({
      routine: { timezone: 'Asia/Kolkata', intent: 'post' },
      todaysDate: '2026-11-25',
      creativeLearnings: learnings,
    } as any).text;
    return /Make more like:/.test(text) && text.includes('offer-first');
  })(),
  'named',
);
check(
  'leftover brief lines are empty when there is nothing measured',
  learningsBriefLines(null).length === 0 && learningsBriefLines(summariseLearnings([])).length === 0,
  'no noise',
);

head('12. The optimiser and the learner read the same enriched rows');

/**
 * The trap this pins.
 *
 * Meta's raw row has no `results` field — it has `actions`. `recommendOptimisation` pauses anything that
 * spent money with `results === 0`. So handing it raw rows WITHOUT deriving results first marks every row
 * "spent with no results at all" and recommends pausing the entire account. The first assertion proves the
 * trap is real; the second proves the wiring avoids it.
 */
const rawMetaRow: any = {
  adset_id: 'set-cold',
  adset_name: 'Cold',
  spend: '2000',
  impressions: '30000',
  clicks: '300',
  ctr: '1.0',
  frequency: '1.4',
  actions: [{ action_type: 'lead', value: '8' }],
};
check(
  'an un-enriched raw row would be read as "spent money, produced nothing" and paused',
  recommendOptimisation([rawMetaRow]).some((action) => action.kind === 'pause'),
  'this is the bug the wiring has to avoid',
);
check(
  'deriving results first turns the same row into a keeper',
  (() => {
    const enriched = recommendOptimisation([{ ...rawMetaRow, results: deriveResults(rawMetaRow) }]);
    return enriched.some((action) => action.kind === 'keep') && !enriched.some((action) => action.kind === 'pause');
  })(),
  '8 leads at 250 per result',
);
check(
  'formatted money would have made it NaN and judged nothing at all',
  (() => {
    const displayRow = { ...rawMetaRow, spend: '₹2,000.00', ctr: '1.00%', results: undefined };
    const judged = recommendOptimisation([displayRow]);
    return judged.length === 1 && judged[0].target === 'everything';
  })(),
  'the old failure mode, stated',
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;