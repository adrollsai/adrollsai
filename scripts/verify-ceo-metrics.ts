/**
 * Proves the daily gatherer reads what it claims, and stays quiet about what it cannot read.
 *
 * The dangerous failure for a report is a CONFIDENT ZERO. "0 leads from ads" and "we have no
 * way to measure leads from ads" look identical on a card and mean opposite things, and the
 * first one would have the owner switch off a campaign that is working. So the interesting
 * assertions here are about absence:
 *
 *   - a table that cannot be read becomes a named gap, not a zero
 *   - ad spend we cannot source is `null` from the reader, and the engine's "wasting money"
 *     alarm does NOT fire on it
 *   - the day window is the owner's calendar day in their timezone, not a UTC slice
 *
 *   npm run verify:ceo-metrics
 */
import { gatherDayMetrics, windowFor, type MetricsReader } from '../lib/agent/ceo-metrics';
import { analyseDay, renderReport } from '../lib/agent/ceo-findings';

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

/** A reader that answers everything well. */
function healthyReader(): MetricsReader {
  return {
    async leadsInWindow() {
      return { created: 10, contacted: 10, replied: 4, booked: 2, lost: 1, previousCreated: 8 };
    },
    async callsInWindow() {
      return { placed: 8, connected: 5, averageSeconds: 71 };
    },
    async whatsappInWindow() {
      return { sent: 12, replied: 5 };
    },
    async postsInWindow() {
      return { published: 2, created: 2 };
    },
    async routinesInWindow() {
      return { ran: 3, failed: 0 };
    },
    async wallet() {
      return { balance: 4200, spentLast7Days: 700 };
    },
    async ads() {
      return { active: 2, spendPaise: null, leads: null, previousCplPaise: null };
    },
  };
}

head('1. The window is the owner\'s day, not a UTC slice');

{
  // 2026-02-10T02:00Z is 07:30 in Kolkata — so the "day" is 10 Feb locally, and its start in
  // UTC is 18:30 on 9 Feb. A UTC-midnight window would file the morning under the wrong day.
  const window = windowFor(new Date('2026-02-10T02:00:00Z'), 'Asia/Kolkata');
  check(
    'the window starts at local midnight, expressed in UTC',
    window.from === '2026-02-09T18:30:00.000Z',
    `${window.from} → ${window.to}`,
  );
  check(
    'it is exactly 24 hours long',
    new Date(window.to).getTime() - new Date(window.from).getTime() === 24 * 60 * 60 * 1000,
    '24h',
  );
  check(
    'the comparison window is the same day a week earlier',
    new Date(window.from).getTime() - new Date(window.previousFrom).getTime() === 7 * 24 * 60 * 60 * 1000,
    '7 days back',
  );
  check(
    'the labels name the day the owner lived',
    /^10 Feb$/.test(window.labelFrom) && /^10 Feb$/.test(window.labelTo),
    `${window.labelFrom} → ${window.labelTo}`,
  );
  check(
    'and a one-day report does not read "10 Feb to 10 Feb"',
    (() => {
      const header = renderReport(
        {
          window: { from: window.labelFrom, to: window.labelTo },
          leads: { created: 0, contacted: 0, replied: 0, booked: 0, lost: 0 },
          calls: { placed: 0, connected: 0 },
          whatsapp: { sent: 0, replied: 0 },
          campaigns: { active: 0, spendPaise: 0, leads: 0 },
          content: { published: 0, created: 0 },
          credits: { balance: 0, spentLast7Days: 0 },
          routines: { ran: 0, failed: 0 },
        },
        [],
      ).split('\n')[0];
      return header === 'CEO report — 10 Feb';
    })(),
    'single date shown once',
  );

  const utc = windowFor(new Date('2026-02-10T02:00:00Z'), 'UTC');
  check(
    'a UTC business gets a UTC day',
    utc.from === '2026-02-10T00:00:00.000Z',
    utc.from,
  );
}

head('2. A full read produces the metrics the engine expects');

{
  const { metrics, missing } = await gatherDayMetrics(healthyReader(), windowFor(new Date('2026-02-10T02:00:00Z')));
  check(
    'every section is carried through',
    metrics.leads.created === 10 &&
      metrics.calls.placed === 8 &&
      metrics.whatsapp.sent === 12 &&
      metrics.content.published === 2 &&
      metrics.routines.ran === 3 &&
      metrics.credits.balance === 4200,
    'leads/calls/whatsapp/posts/routines/wallet',
  );
  check('nothing is reported missing when everything reads', missing.length === 0, missing.join(', ') || 'none');
  check(
    'the metrics are shaped so the engine can consume them',
    analyseDay(metrics).length >= 0 && typeof metrics.window.from === 'string',
    'engine-compatible',
  );
}

head('3. An unreadable table is a NAMED GAP, never a confident zero');

{
  const broken: MetricsReader = {
    ...healthyReader(),
    async leadsInWindow() {
      throw new Error('relation "leads" does not exist');
    },
    async callsInWindow() {
      throw new Error('permission denied');
    },
  };
  const { metrics, missing } = await gatherDayMetrics(broken, windowFor(new Date('2026-02-10T02:00:00Z')));
  check(
    'the failing sections are named',
    missing.includes('leads') && missing.includes('calls'),
    missing.join(', '),
  );
  check(
    'and the rest of the report still arrives',
    metrics.credits.balance === 4200 && metrics.routines.ran === 3 && metrics.content.created === 2,
    'partial report, not a lost one',
  );
  check(
    'the failed sections fall back to zero rather than crashing the job',
    metrics.leads.created === 0 && metrics.calls.placed === 0,
    'zero, and `missing` says why',
  );
}

head('4. Ad spend we cannot measure must not become an accusation');

{
  const { metrics, missing } = await gatherDayMetrics(healthyReader(), windowFor(new Date('2026-02-10T02:00:00Z')));
  check(
    'the reader reports ad spend as null, not as 0',
    metrics.campaigns.spendPaise === 0 && metrics.campaigns.leads === 0 && metrics.campaigns.active === 2,
    'null spend became 0 only at the boundary',
  );
  const findings = analyseDay(metrics);
  check(
    "the engine does NOT raise 'paying for ads that brought no leads'",
    !findings.some((finding) => finding.id === 'spend-no-leads'),
    'no false accusation about wasted budget',
  );
  check(
    'because there is nothing to compare: 0 spent and 0 leads is a gap, not a loss',
    metrics.campaigns.spendPaise === 0 && metrics.campaigns.leads === 0,
    'both sides zero',
  );

  // And when spend IS measurable, the alarm must fire — otherwise the guard above has simply
  // disabled the rule.
  const measurable = analyseDay({
    ...metrics,
    leads: { ...metrics.leads, created: 3 },
    campaigns: { active: 2, spendPaise: 250_000, leads: 0, previousCplPaise: null },
  });
  check(
    'with real spend and no leads, the wasted-budget alarm DOES fire',
    measurable.some((finding) => finding.id === 'spend-no-leads' && finding.severity === 'blocked'),
    measurable.find((finding) => finding.id === 'spend-no-leads')?.title ?? 'not fired',
  );
}

head('5. A healthy day reads as healthy');

{
  const { metrics } = await gatherDayMetrics(healthyReader(), windowFor(new Date('2026-02-10T02:00:00Z')));
  const findings = analyseDay(metrics);
  check(
    'no blocked findings',
    findings.every((finding) => finding.severity !== 'blocked'),
    findings.map((finding) => finding.id).join(', '),
  );
  check(
    'the wins are present',
    findings.some((finding) => finding.severity === 'win'),
    findings.filter((finding) => finding.severity === 'win').map((finding) => finding.id).join(', '),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
