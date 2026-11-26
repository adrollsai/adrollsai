/**
 * GATE: the daily email must not describe a day it cannot read.
 *
 * WHY THIS GATE EXISTS
 * The owner received a "Today's wrap" that said their daily marketing did not run. On production on
 * 2026-11-26 the routine ledger held 79 `queued` rows out of 80 over seven days while every harness
 * run behind them had already ended. The findings engine derived "it is a job that is switched off"
 * from `routines.ran === 0` — a NUMBER, treated as a fact. Against an unsettled ledger a zero is a
 * reading error, and the email stated it as something true about the owner's business. The wrap also
 * printed the raw status "queued" under the heading "What went out".
 *
 * The owner's rule, in their words: it should only make sense to send the email once the CEO has
 * actually run and analysed. So the send is now gated on a verdict about the LEDGER:
 *
 *   1. nothing queued for the day and no rollup claiming otherwise -> "did not run" is allowed;
 *   2. rows exist but some are still `queued` -> NOT allowed, and the wrap is HELD with a recorded
 *      reason rather than sent;
 *   3. every row settled -> the day is readable, so "did not run" is not claimable either way;
 *   4. the stored rollup disagrees with the ledger -> the disagreement is named, never repeated.
 *
 * Everything below is pure: no database, no model, no clock of its own.
 *
 *   npm run verify:digest-honesty
 */
import { readFileSync } from 'node:fs';
import { routineLedgerVerdict, digestReportedDay, type RoutineLedgerDay } from '../lib/agent/digest-ledger';
import { analyseDay, type DayMetrics } from '../lib/agent/ceo-findings';
import { buildDigest } from '../lib/agent/digest';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string | number | null = '') {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail !== '' && detail !== null ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail !== '' && detail !== null ? `  — ${detail}` : ''}`);
  }
}
const head = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);

const ledger = (rows: number, queued: number): RoutineLedgerDay => ({ rows, queued, settled: rows - queued });

/** The lie the owner was sent. It is still legitimate on a day with no row at all. */
const LIAR = 'Your daily marketing did not run';

/** A day with nothing running at all: every metric zero, which is what produced the false claim. */
function emptyDay(): DayMetrics {
  return {
    window: { from: '2026-11-25T00:00:00.000Z', to: '2026-11-26T00:00:00.000Z' },
    leads: { created: 0, contacted: 0, replied: 0, booked: 0, lost: 0, previousCreated: 0 },
    calls: { placed: 0, connected: 0, averageSeconds: 0 },
    whatsapp: { sent: 0, replied: 0 },
    campaigns: { active: 0, spendPaise: 0, leads: 0, previousCplPaise: null },
    content: { published: 0, created: 0 },
    credits: { balance: 0, spentLast7Days: 0 },
    routines: { ran: 0, failed: 0 },
  };
}

const titles = (metrics: DayMetrics, ledgerInput?: Parameters<typeof analyseDay>[1]) =>
  analyseDay(metrics, ledgerInput).map((f) => f.title);

// ── 1. the four verdicts ─────────────────────────────────────────────────────
head('1. What a day supports, given its ledger and its stored summary');

{
  const nothing = routineLedgerVerdict({ ledger: ledger(0, 0), rollupRoutineRuns: 0, dayLabel: '25 Nov' });
  check('no rows and a rollup that agrees -> nothing-queued', nothing.verdict === 'nothing-queued', nothing.verdict);
  check('and only then may "did not run" be said', nothing.canClaimNothingRan === true);
  check('the sentence names the day', /25 Nov/.test(nothing.sentence), nothing.sentence);
  check('and nothing is held', nothing.holdEod === false);

  const noRollupYet = routineLedgerVerdict({ ledger: ledger(0, 0), rollupRoutineRuns: null });
  check('a day with no rollup row yet still allows it (today has no summary)', noRollupYet.verdict === 'nothing-queued');

  const settledDay = routineLedgerVerdict({ ledger: ledger(1, 0), rollupRoutineRuns: 1, dayLabel: '25 Nov' });
  check('a settled row -> settled', settledDay.verdict === 'settled', settledDay.verdict);
  check('and "did not run" is not claimable on a day that ran', settledDay.canClaimNothingRan === false);
  check('a settled day is not held', settledDay.holdEod === false);

  const halfDone = routineLedgerVerdict({ ledger: ledger(3, 1), rollupRoutineRuns: 2 });
  check('some rows still queued -> unreconciled', halfDone.verdict === 'unreconciled', halfDone.verdict);
  check('"did not run" is refused', halfDone.canClaimNothingRan === false);
  check('the wrap is held', halfDone.holdEod === true);
  check('the hold carries a reason, not silence', /still say they are waiting/.test(halfDone.holdReason || ''), halfDone.holdReason);
  check('the reason counts the rows that are waiting', /1 daily job of 3/.test(halfDone.holdReason || ''), halfDone.holdReason);
}

// ── 2. the rollup disagreement, both directions ──────────────────────────────
head('2. When the stored summary and the ledger disagree, the disagreement is named');

{
  // The brief's exact case: summary says 0, ledger holds rows.
  const stale = routineLedgerVerdict({ ledger: ledger(1, 0), rollupRoutineRuns: 0, dayLabel: '24 Nov' });
  check('ledger rows vs a summary of 0 -> rollup-contradicts-ledger', stale.verdict === 'rollup-contradicts-ledger', stale.verdict);
  check('"did not run" is refused', stale.canClaimNothingRan === false);
  check('the sentence says the summary is stale', /stale/i.test(stale.sentence), stale.sentence);
  check('and names the day', /24 Nov/.test(stale.sentence), stale.sentence);
  check('a stale summary does not hold the email — the ledger can describe the day', stale.holdEod === false);

  const other = routineLedgerVerdict({ ledger: ledger(0, 0), rollupRoutineRuns: 2, dayLabel: '24 Nov' });
  check('a summary of 2 with no ledger rows is a disagreement too', other.verdict === 'rollup-contradicts-ledger', other.verdict);
  check('"did not run" is refused there as well', other.canClaimNothingRan === false);
}

// ── 3. nonsense input must not become a claim ────────────────────────────────
head('3. Bad counts cannot manufacture a verdict');

{
  const negative = routineLedgerVerdict({ ledger: { rows: -5, queued: -2, settled: -1 } });
  check('negative counts read as no rows, not as settled work', negative.verdict === 'nothing-queued', negative.verdict);

  const overQueued = routineLedgerVerdict({ ledger: { rows: 2, queued: 9, settled: 9 } });
  check('a queued count larger than the rows is clamped, not trusted', overQueued.verdict === 'unreconciled', overQueued.verdict);
  check('and the reason never claims more waiting rows than rows', /2 daily jobs of 2/.test(overQueued.sentence), overQueued.sentence);

  const nan = routineLedgerVerdict({ ledger: { rows: NaN as any, queued: NaN as any, settled: NaN as any } });
  check('NaN reads as no rows', nan.verdict === 'nothing-queued', nan.verdict);
}

// ── 4. the findings engine: the lie, and its replacement ─────────────────────
head('4. The findings engine may only claim "did not run" against a readable ledger');

{
  const day = emptyDay();
  const unguarded = titles(day);
  check('with no ledger verdict the old sentence still fires (it is true when nothing was queued)', unguarded.includes(LIAR), unguarded.join(' | '));

  const unreconciled = titles(day, { routineLedger: { ledger: ledger(1, 1), rollupRoutineRuns: null, dayLabel: '26 Nov' } });
  check('an unsettled ledger silences it', !unreconciled.includes(LIAR), unreconciled.join(' | '));
  check('and says the record has not been settled instead', unreconciled.some((t) => /not been settled yet/i.test(t)), unreconciled.join(' | '));

  const findings = analyseDay(day, { routineLedger: { ledger: ledger(1, 1), rollupRoutineRuns: null, dayLabel: '26 Nov' } });
  const unsettledFinding = findings.find((f) => f.id === 'engine-ledger-unsettled');
  check('the replacement finding is addressable by id', Boolean(unsettledFinding), unsettledFinding?.id ?? findings.map((f) => f.id).join(','));
  check('it is a risk, not a note', unsettledFinding?.severity === 'risk', unsettledFinding?.severity);
  check('its evidence is the ledger verdict in plain words', /still say they are waiting/.test(unsettledFinding?.evidence || ''), unsettledFinding?.evidence);
  check('and it does not tell the owner to switch anything on', !/switch it on/i.test(unsettledFinding?.recommendation || ''), unsettledFinding?.recommendation);

  const staleRollup = titles(day, { routineLedger: { ledger: ledger(1, 0), rollupRoutineRuns: 0, dayLabel: '24 Nov' } });
  check('a stale rollup also silences the lie', !staleRollup.includes(LIAR), staleRollup.join(' | '));
  check('and is reported as a disagreement', staleRollup.some((t) => /disagrees with the job ledger/i.test(t)), staleRollup.join(' | '));

  const realDay = emptyDay();
  realDay.routines = { ran: 1, failed: 1 };
  const ranAndFailed = titles(realDay, { routineLedger: { ledger: ledger(1, 0), rollupRoutineRuns: 1, dayLabel: '25 Nov' } });
  check('a day that ran and failed still says so', ranAndFailed.some((t) => /jobs failed/i.test(t)), ranAndFailed.join(' | '));
  check('and never says it did not run', !ranAndFailed.includes(LIAR));

  const genuinelyOff = titles(day, { routineLedger: { ledger: ledger(0, 0), rollupRoutineRuns: 0, dayLabel: '25 Nov' } });
  check('a day with no row at all keeps the original, true warning', genuinelyOff.includes(LIAR), genuinelyOff.join(' | '));
  check('and gets no false "unsettled" note on top', !genuinelyOff.some((t) => /not been settled yet/i.test(t)));
}

// ── 5. the emails themselves ────────────────────────────────────────────────
head('5. What the email text is allowed to say');

{
  const wrap = buildDigest({ businessName: 'Test Ltd', slot: 'eod', dateLabel: '26 Nov', done: [] });
  check('an empty wrap still says nothing went out (the hold is what prevents this send)', /nothing went out today/.test(wrap.html));

  const failed = buildDigest({
    businessName: 'Test Ltd',
    slot: 'eod',
    dateLabel: '26 Nov',
    done: [{ label: 'Daily marketing failed', detail: 'Platform AI provider out of credit: Insufficient Balance' }],
  });
  check("a failed day carries the provider's own words", /Insufficient Balance/.test(failed.html));

  const plan = buildDigest({ businessName: 'Test Ltd', slot: 'morning', dateLabel: '26 Nov', done: [] });
  check(
    'the morning plan keeps its own heading',
    /Today's plan/.test(plan.html) && /today's plan/.test(plan.subject),
    `${plan.subject} | ${/Today's plan/.test(plan.html)}`,
  );
}

// ── 6. the wiring: the cron actually does this ──────────────────────────────
head('6. The digest cron sweeps, holds, records, and passes the verdict to the engine');

{
  const route = readFileSync('app/api/cron/ceo-digest/route.ts', 'utf8');

  check('the digest settles the ledger before describing it', /reconcileRoutineRuns\(supabase\)\.catch\(/.test(route));
  check(
    'and the sweep happens before the first send can',
    route.indexOf('reconcileRoutineRuns(') < route.indexOf('sendGenericEmail('),
    `${route.indexOf('reconcileRoutineRuns(')} < ${route.indexOf('sendGenericEmail(')}`,
  );
  check('it asks for a verdict rather than reading a status itself', /routineLedgerVerdict\(ledgerInput\)/.test(route));
  check('the wrap is held when the day cannot be read', /slot === 'eod' && ledgerDecision\.holdEod/.test(route));
  check('a held wrap is skipped, never silently dropped', /skipped\.push\(`\$\{routine\.id\}: held — \$\{reason\}`\)/.test(route));
  check('the hold is written onto the run row', /eod_hold: \{ reason, day: reportedKey, at: now\.toISOString\(\) \}/.test(route));
  /**
   * The hold must not stamp `eod_sent_at`, or the wrap would never be sent at all once the day
   * settles. Asserted on the hold branch's own body rather than on the whole file.
   */
  const holdAt = route.indexOf("slot === 'eod' && ledgerDecision.holdEod");
  const holdBlock = holdAt === -1 ? '' : route.slice(holdAt, route.indexOf('continue;', holdAt));
  check(
    'and it deliberately does not stamp eod_sent_at, so the wrap can still go out later',
    holdBlock.length > 0 && !/eod_sent_at/.test(holdBlock),
    `${holdBlock.length} chars in the hold branch`,
  );
  check('the verdict is passed into the findings engine', /analyseDay\(metrics, \{ routineLedger: ledgerInput \}\)/.test(route));
  check('what was allowed is recorded on the run for audit', /ledger_check: \{/.test(route));
  check('the reported day is resolved from the slot, not guessed', /digestReportedDay\(slot, now\)/.test(route));
  check('the stored rollup is read for the cross-check', /from\('ceo_daily_rollups'\)/.test(route));
  check('a failing day names the run error instead of the bare word "failed"', /runError \? runError\.slice\(0, 240\)/.test(route));
  check('the raw status is no longer printed as output', !/\$\{routine\.name\} — \$\{run\.status\}/.test(route));
  check('the response reports the sweep so the log is checkable', /reconciled,\n\s*\}\);/.test(route));
}

// ── 7. which day each email is about ───────────────────────────────────────
head('7. The morning email reports yesterday; the wrap reports today');

{
  const now = new Date('2026-11-26T13:30:00Z'); // 19:00 IST
  const eodDay = digestReportedDay('eod', now);
  check('the wrap is about today', eodDay.toISOString() === now.toISOString(), eodDay.toISOString());
  const morningDay = digestReportedDay('morning', now);
  check('the morning email is about yesterday', morningDay.toISOString() === new Date(now.getTime() - 86_400_000).toISOString(), morningDay.toISOString());
}

console.log(`\n${'─'.repeat(62)}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('\nAn email that describes a day it cannot read is worse than no email.');
  process.exit(1);
}
console.log('The daily email now waits for a day it can actually describe.');
