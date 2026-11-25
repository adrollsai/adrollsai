/**
 * Proves the Optimize analysis judges creatives by what they bought, not by what they spent.
 *
 * The failures this locks out are the ones that were actually shipping:
 *
 *   - ranking by spend, which puts the expensive creative that converted nobody at the top;
 *   - treating an ad with 200 impressions as a loser instead of unknown, which invites the owner
 *     to kill a creative that has not been given a chance yet;
 *   - declaring a winner when there is nothing to compare it against.
 *
 *   npm run verify:creative-performance
 */
import {
  analyseCreatives,
  LOSER_MULTIPLE,
  readCreative,
  WINNER_MULTIPLE,
} from '../lib/ads/creative-performance';

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
const head = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 56 - title.length))}`);

/** Meta-shaped ad-level insights rows: money in rupees, leads inside `actions`. */
const row = (adId: string, name: string, spend: number, impressions: number, leads: number, extra: Record<string, any> = {}) => ({
  ad_id: adId,
  ad_name: name,
  spend: String(spend),
  impressions: String(impressions),
  clicks: String(Math.round(impressions * 0.01)),
  actions: leads > 0 ? [{ action_type: 'lead', value: String(leads) }] : [],
  ...extra,
});

head('1. A creative is judged by what it bought');

{
  const analysis = analyseCreatives([
    // The old code's idea of "top": most spend, first in the list.
    row('a1', 'Expensive loser', 9000, 50_000, 0),
    row('a2', 'Cheap winner', 2000, 40_000, 50),
    row('a3', 'Average one', 3000, 30_000, 20),
    row('a4', 'Another average', 1500, 20_000, 10),
    row('a5', 'Wasteful spender', 7000, 60_000, 1),
  ]);

  const expensive = analysis.creatives.find((c) => c.adId === 'a1')!;
  const cheap = analysis.creatives.find((c) => c.adId === 'a2')!;
  const wasteful = analysis.creatives.find((c) => c.adId === 'a5')!;

  check('the big spender with no leads is a loser', expensive.verdict === 'loser', `${expensive.verdict}: ${expensive.why}`);
  check('…and it is not first in the ranking', analysis.creatives[0].adId !== 'a1', `first is ${analysis.creatives[0].adName}`);
  check('the cheap-per-lead creative is the winner', cheap.verdict === 'winner', `${cheap.verdict} at ${cheap.costPerResultPaise} paise`);
  check('it is first', analysis.creatives[0].adId === 'a2');
  check('the creative that spent most per enquiry is also a loser', wasteful.verdict === 'loser', wasteful.why);
  // Portfolio baseline here is 22,500 spent / 81 enquiries = ₹278 each, so both ₹150 creatives are
  // genuinely well below usual and both big spenders are above it.
  check('winners and losers are separated', analysis.winners.length === 3 && analysis.losers.length === 2, `${analysis.winners.length}W/${analysis.losers.length}L`);
  check('cost per enquiry is in paise', cheap.costPerResultPaise === 4000, String(cheap.costPerResultPaise));
  check(
    'the summary says how much the losers wasted',
    /should stop/.test(analysis.summary) && /16,000/.test(analysis.summary) && /one of them brought nobody|1 of them/.test(analysis.summary),
    analysis.summary
  );
}

head('2. No data is not a verdict');

{
  const analysis = analyseCreatives([
    row('b1', 'Just started', 40, 200, 0),
    row('b2', 'Working', 5000, 40_000, 25),
  ]);
  const fresh = analysis.creatives.find((c) => c.adId === 'b1')!;
  check('a creative with almost no delivery is "too early", not a loser', fresh.verdict === 'too_early', fresh.why);
  check('and it is not in the losers list', !analysis.losers.some((c) => c.adId === 'b1'));
  check('the counts say so honestly', analysis.totals.judged === 1 && analysis.totals.unjudged === 1, `${analysis.totals.judged}/${analysis.totals.unjudged}`);
}

head('2b. Two creatives are not a comparison');

{
  // With two, whatever number sits between them makes one a winner and the other a loser on no
  // evidence — so neither is called anything until a third carries real results.
  const analysis = analyseCreatives([
    row('bb1', 'A', 2000, 40_000, 50),
    row('bb2', 'B', 3000, 30_000, 20),
  ]);
  check('no winner is declared from two creatives', analysis.winners.length === 0, `${analysis.winners.length} winners`);
  check('no loser is declared from two creatives', analysis.losers.length === 0, `${analysis.losers.length} losers`);
  check('the reason says there is nothing to compare against', /enough delivery to compare/.test(analysis.creatives[0].why), analysis.creatives[0].why);
  check('and the analysis reports how many were comparable', analysis.comparable === 2, String(analysis.comparable));
}

head('3. Spend alone earns a judgement');

{
  // 400 impressions but ₹800 spent is enough to call: money moved and nothing came back.
  const analysis = analyseCreatives([row('c1', 'Paying, nobody in', 800, 400, 0)]);
  check('a cheap-delivery ad that still spent is judged', analysis.creatives[0].verdict === 'loser', analysis.creatives[0].why);
}

head('4. A single creative cannot win a comparison');

{
  const analysis = analyseCreatives([row('d1', 'Only one', 5000, 50_000, 20)]);
  check('it is the baseline, not a winner', analysis.creatives[0].verdict === 'average', analysis.creatives[0].verdict);
  check('and the reason says it is the baseline', /baseline|only creative|enough delivery to compare/i.test(analysis.creatives[0].why), analysis.creatives[0].why);
  check('there is no invented winner', analysis.winners.length === 0);
}

head('5. The yardstick is this account, not an industry average');

{
  const analysis = analyseCreatives([
    row('e1', 'A', 10_000, 50_000, 10), // 1,000 each
    row('e2', 'B', 10_000, 50_000, 10), // 1,000 each
    row('e3', 'C', 6000, 50_000, 20), // 300 each → the winner
    row('e4', 'D', 20_000, 50_000, 5), // 4,000 each → the loser
  ]);
  // Portfolio: 46,000 spent, 45 enquiries → ₹1,022 each. The two mid-priced creatives stay
  // "average", which the median of four would have got wrong by dragging the yardstick down.
  check('the yardstick is the account’s portfolio cost per enquiry', analysis.baselineCostPerResultPaise === 102_222, String(analysis.baselineCostPerResultPaise));
  const a = analysis.creatives.find((x) => x.adId === 'e1')!;
  const c = analysis.creatives.find((x) => x.adId === 'e3')!;
  const d = analysis.creatives.find((x) => x.adId === 'e4')!;
  check('the cheapest is a winner', c.verdict === 'winner', c.verdict);
  check('the most expensive is a loser', d.verdict === 'loser', d.verdict);
  check('the mid-priced bulk of the spend is not called a loser', a.verdict === 'average', `${a.verdict}: ${a.why}`);
  check('and the loser says how many times worse it is', /3\.9× your usual/.test(d.why), d.why);
  check('the thresholds are the documented ones', WINNER_MULTIPLE === 0.8 && LOSER_MULTIPLE === 1.5);
}

head('6. The numbers add up');

{
  const analysis = analyseCreatives([
    row('f1', 'A', 1000, 10_000, 10, { imageUrl: 'https://x/a.jpg' }),
    row('f2', 'B', 3000, 20_000, 10),
  ]);
  check('total spend is summed in paise', analysis.totals.spendPaise === 400_000, String(analysis.totals.spendPaise));
  check('total enquiries are summed', analysis.totals.results === 20, String(analysis.totals.results));
  check('overall cost per enquiry is derived', analysis.totals.costPerResultPaise === 20_000, String(analysis.totals.costPerResultPaise));
  check('the creative metadata is carried through', analysis.creatives.some((c) => c.imageUrl === 'https://x/a.jpg'));
  check('the window is stated, never implied', /last 30 days/.test(analysis.window), analysis.window);
}

head('7. CTR is derived when Meta omits it');

{
  const derived = readCreative({ ad_id: 'g1', ad_name: 'G', spend: '100', impressions: '10000', clicks: '250', actions: [] })!;
  check('clicks / impressions when there is no ctr', Math.abs(Number(derived.ctrPct) - 2.5) < 0.01, String(derived.ctrPct));
  const given = readCreative({ ad_id: 'g2', ctr: '3.75', impressions: '1000', clicks: '10' })!;
  check('Meta’s own ctr wins when present', given.ctrPct === 3.75, String(given.ctrPct));
  check('a row with no ad id is not a creative', readCreative({ spend: '10' }) === null);
}

head('8. Nothing measured is said plainly');

{
  const empty = analyseCreatives([]);
  check('no creatives gives an honest message', /nothing to judge/i.test(empty.summary), empty.summary);
  check('and zero totals, not invented ones', empty.totals.spendPaise === 0 && empty.totals.results === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
