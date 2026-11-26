/**
 * The CEO's daily findings: what the numbers say, what it means, and what we would do about
 * it — reported, never done.
 *
 * WHAT THIS IS NOT
 * Not an agent that acts. The owner was explicit: the CEO should "only give findings and
 * reports". So every entry here ends in a *recommendation*, and anything that would spend
 * money or message a customer is marked `needsReview`, which puts it behind the review gate
 * rather than in a queue that runs itself. A daily report that quietly launches things is
 * not a report.
 *
 * WHY EVIDENCE IS A FIELD AND NOT DECORATION
 * "Your cost per lead is high" is an opinion. "₹4,820 over the last 7 days bought 6 enquiries —
 * ₹803 each, against ₹310 the week before" is a finding. Every entry carries the numbers it was
 * derived from, so the owner can disagree with the conclusion and still trust the arithmetic.
 * That is also what makes the output testable.
 *
 * WRITTEN FOR THE OWNER, NOT FOR A MARKETER
 * This text lands in the CEO tab, the email and the push notification. The person reading it runs
 * a business: they know what an enquiry is and what it costs them, and they have never had a
 * reason to learn what CPL, CTR, impressions or "attribution" mean. So there is a hard rule in
 * this file, enforced by `verify:ceo-plain-language`:
 *
 *   NO ACRONYMS, NO TERMS OF ART, AND NO NUMBER WITHOUT SOMETHING TO COMPARE IT TO.
 *
 * A rate is written "4 in 10 calls were answered", not "40% connect rate". A price is written
 * "₹803 each, against ₹310 the week before", not "CPL ₹803 (+159%)". If a sentence needs a
 * glossary to land, the sentence is the bug.
 *
 * WHY THE RULES ARE ORDERED THE WAY THEY ARE
 * The list is sorted by what would cost the owner most if ignored: money going out with
 * nothing coming back, then enquiries nobody called, then drift, then wins. A report whose first
 * line is a compliment gets skimmed.
 */

import { routineLedgerVerdict, type RoutineLedgerDay } from './digest-ledger';

export interface DayMetrics {
  /** Yesterday, or the window being reported. */
  window: { from: string; to: string };
  leads: {
    created: number;
    contacted: number;
    replied: number;
    booked: number;
    lost: number;
    /** Leads created in the same window a week ago, for comparison. */
    previousCreated?: number;
    /**
     * Enquiries that arrived in the LAST 7 DAYS — the window the ad figures cover.
     *
     * Ad spend and ad results are always a 7-day figure (`campaigns.spendPaise` says so), so any
     * comparison against them must use seven days of leads too. The first version compared the 7-day
     * ad result against this report's one-day lead count and announced "ads say 74 enquiries while only
     * 2 reached your list" — a 98% catastrophe invented by subtracting two different units. When this is
     * absent the ad-versus-list check stays silent rather than comparing unlike things.
     */
    last7Days?: number;
  };
  calls: { placed: number; connected: number; averageSeconds?: number };
  whatsapp: { sent: number; replied: number };
  campaigns: {
    active: number;
    /**
     * Money spent on ads, in paise. Read from Meta over the last 7 days — one day of ad delivery is
     * noise, and a week is the unit the judgement thresholds assume. Null is impossible here (it
     * becomes 0), which is why `gatherDayMetrics` names 'ads' in `missing` when the source could
     * not be read: zero spend and unknown spend must not look the same.
     */
    spendPaise: number;
    /** Enquiries the ads brought in, over the same 7 days. */
    leads: number;
    /** What one enquiry cost the week before, in paise, when known. */
    previousCplPaise?: number | null;
  };
  content: { published: number; created: number };
  credits: { balance: number; spentLast7Days: number };
  /** How many days of the daily marketing work actually ran in the window. */
  routines: { ran: number; failed: number };
}

export type Severity = 'blocked' | 'risk' | 'win' | 'note';

export interface Finding {
  id: string;
  severity: Severity;
  /** The headline, in the owner's language. */
  title: string;
  /** The numbers it came from, with the comparison that gives them meaning. Never empty. */
  evidence: string;
  /** What we would do — as a suggestion. */
  recommendation: string;
  /** True when acting on this would spend money or reach a customer. */
  needsReview: boolean;
}

const rupees = (paise: number): string => `₹${Math.round((Number(paise) || 0) / 100).toLocaleString('en-IN')}`;

/** "4 in 10" — a rate a person can picture, instead of "40%". */
function inTen(part: number, whole: number): string {
  if (whole <= 0) return '0 in 10';
  const ofTen = Math.round((part / whole) * 10);
  return `${ofTen} in 10`;
}

/** "3 more than the week before" / "the same as the week before" / nothing when unknown. */
function comparedToLastWeek(now: number, before: number | null | undefined, noun: string): string {
  if (before === null || before === undefined) return `${now} ${noun}`;
  if (now === before) return `${now} ${noun}, the same as the week before`;
  const diff = Math.abs(now - before);
  return now > before
    ? `${now} ${noun}, ${diff} more than the week before`
    : `${now} ${noun}, ${diff} fewer than the week before`;
}

/** Days of runway at last week's burn. null when nothing was spent. */
export function creditRunwayDays(metrics: DayMetrics): number | null {
  const daily = metrics.credits.spentLast7Days / 7;
  if (!Number.isFinite(daily) || daily <= 0) return null;
  return Math.floor(metrics.credits.balance / daily);
}

/** What one paid enquiry cost, in paise, or null when no enquiries were attributed. */
export function costPerLeadPaise(metrics: DayMetrics): number | null {
  if (metrics.campaigns.leads <= 0) return null;
  return Math.round(metrics.campaigns.spendPaise / metrics.campaigns.leads);
}

export interface AnalyseOptions {
  /** Suppresses the "nothing happened" notes: a daily digest wants them, a chat reply does not. */
  quiet?: boolean;
  /**
   * What the routine ledger can support about the day being reported.
   *
   * Optional, and absent means "assume the ledger is settled" — which is what every existing caller
   * does and is true of a day that is already over. The digest passes it because it mails the owner
   * about a day that may still be unreadable, and there the difference between "nothing was queued",
   * "it ran" and "nothing has settled my record yet" is the whole question. See
   * `lib/agent/digest-ledger.ts` for why an unsettled ledger must never be reported as a stopped job.
   */
  routineLedger?: {
    ledger: RoutineLedgerDay;
    rollupRoutineRuns?: number | null;
    dayLabel?: string;
  };
}

/**
 * Turn one day of numbers into ranked findings.
 *
 * Pure. `options.quiet` suppresses the "nothing happened" notes, which a daily digest wants
 * but a chat reply to "how did today go?" does not.
 */
export function analyseDay(metrics: DayMetrics, options: AnalyseOptions = {}): Finding[] {
  const findings: Finding[] = [];
  const { leads, calls, whatsapp, campaigns, content, credits, routines } = metrics;

  /**
   * The ledger verdict, resolved once and used twice: it decides whether "did not run" may be said
   * at all, and what is said instead when it may not.
   */
  const ledgerDecision = options.routineLedger
    ? routineLedgerVerdict({
        ledger: options.routineLedger.ledger,
        rollupRoutineRuns: options.routineLedger.rollupRoutineRuns ?? null,
        dayLabel: options.routineLedger.dayLabel,
      })
    : null;

  // ── money going out with nothing coming back
  const cpl = costPerLeadPaise(metrics);
  if (campaigns.spendPaise > 0 && campaigns.leads === 0) {
    findings.push({
      id: 'spend-no-leads',
      severity: 'blocked',
      title: 'You are paying for ads that brought nobody',
      evidence:
        `You spent ${rupees(campaigns.spendPaise)} on ads over the last 7 days and not one enquiry came ` +
        'from them. The money went out; nothing came back.',
      recommendation:
        'Stop that ad before it spends again. It is one of three things — the wrong people saw it, the ' +
        'offer was unclear, or the page it sends them to is broken — and we can find out which in a day. ' +
        'Nothing has been changed yet; this is your call.',
      needsReview: true,
    });
  } else if (cpl !== null && campaigns.previousCplPaise && cpl > campaigns.previousCplPaise * 1.4) {
    findings.push({
      id: 'cpl-rising',
      severity: 'risk',
      title: `Each enquiry now costs you ${rupees(cpl)}`,
      evidence:
        `${rupees(campaigns.spendPaise)} over the last 7 days bought ${campaigns.leads} ` +
        `enquir${campaigns.leads === 1 ? 'y' : 'ies'} — ${rupees(cpl)} each, against ` +
        `${rupees(campaigns.previousCplPaise)} each the week before.`,
      recommendation:
        'A fresh creative is usually cheaper than a bigger budget. Say the word and I will make one that ' +
        'argues the offer instead of the product — that is the change that most often brings this number ' +
        'back down.',
      needsReview: true,
    });
  }

  // ── enquiries the ads claim, that never arrived
  //
  // Both halves must cover the SAME seven days: the ad figures always do, and `leads.last7Days` carries
  // the matching lead count. Comparing the 7-day ad result against a single day's leads is how this once
  // reported "74 enquiries, only 2 reached your list" on an account where 37 leads had arrived and the
  // other 36 were the same 37 leads counted twice by Meta.
  //
  // Both numbers being true is also possible — a person who enquires may already be on the list — so the
  // gap is stated as a question, not an accusation, and only when it is large enough to be worth asking.
  const adsEnquiries = campaigns.leads;
  const leadsSameWeek = leads.last7Days;
  if (
    campaigns.spendPaise > 0 &&
    adsEnquiries > 0 &&
    typeof leadsSameWeek === 'number' &&
    leadsSameWeek < adsEnquiries * 0.6
  ) {
    findings.push({
      id: 'ads-vs-list-gap',
      severity: 'risk',
      title: `Ads say ${adsEnquiries} enquiries; ${leadsSameWeek} reached your list`,
      evidence:
        `Over the same 7 days your ads reported ${adsEnquiries} enquir${adsEnquiries === 1 ? 'y' : 'ies'} ` +
        `for ${rupees(campaigns.spendPaise)}, and ${leadsSameWeek} new enquir${leadsSameWeek === 1 ? 'y' : 'ies'} ` +
        'arrived in your list.',
      recommendation:
        'Some of those are probably people already on the list, or the same person counted twice. If they are not, the ' +
        'enquiry is being paid for and then lost before it reaches you — let me trace one enquiry from the ad to your ' +
        'list and find where it stops.',
      needsReview: false,
    });
  }

  // ── enquiries nobody touched
  const untouched = Math.max(0, leads.created - leads.contacted);
  if (leads.created > 0 && untouched === leads.created) {
    findings.push({
      id: 'leads-untouched',
      severity: 'blocked',
      title: `${leads.created} ${leads.created === 1 ? 'person asked' : 'people asked'} and nobody replied`,
      evidence:
        `${leads.created} enquir${leads.created === 1 ? 'y' : 'ies'} came in and none of them has been ` +
        'contacted yet.',
      recommendation:
        'These are the cheapest sales you will ever get — they already came to you. Let me send the first ' +
        'reply to this batch today; you will see the message before it goes out.',
      needsReview: true,
    });
  } else if (untouched > 0) {
    findings.push({
      id: 'leads-partly-untouched',
      severity: 'risk',
      title: `${untouched} ${untouched === 1 ? 'person is' : 'people are'} still waiting for a reply`,
      evidence: `${leads.created} enquir${leads.created === 1 ? 'y' : 'ies'} came in, ${leads.contacted} have been contacted.`,
      recommendation: 'Reply to the rest today. After a day, the chance of an answer roughly halves.',
      needsReview: false,
    });
  }

  // ── the phone
  if (calls.placed > 0 && calls.connected === 0) {
    findings.push({
      id: 'calls-not-connecting',
      severity: 'risk',
      title: 'None of the calls were answered',
      evidence: `${calls.placed} calls were made and none was picked up.`,
      recommendation:
        'This is almost always the hour, not the script. Try a different time of day before we rewrite ' +
        'anything.',
      needsReview: false,
    });
  } else if (calls.placed > 0) {
    const answered = inTen(calls.connected, calls.placed);
    const good = calls.connected / calls.placed >= 0.4;
    findings.push({
      id: 'call-connect-rate',
      severity: good ? 'win' : 'note',
      title: `${answered} calls were answered`,
      evidence:
        `${calls.connected} of ${calls.placed} calls were picked up` +
        (calls.averageSeconds ? `, and the average conversation lasted ${Math.round(calls.averageSeconds)} seconds` : '') +
        '.',
      recommendation: good
        ? 'This is working. Call the rest of the list the same way, at the same hour.'
        : 'Try a different hour before changing what is said on the call.',
      needsReview: false,
    });
  }

  // ── money running out
  const runway = creditRunwayDays(metrics);
  if (runway !== null && runway <= 3) {
    findings.push({
      id: 'credits-low',
      severity: runway <= 1 ? 'blocked' : 'risk',
      title: runway <= 1 ? 'Your credits run out today' : `About ${runway} days of credits left`,
      evidence:
        `${credits.balance} credits left, and last week you used about ` +
        `${Math.round(credits.spentLast7Days / 7)} a day making things.`,
      recommendation:
        'Top up before the daily work stops halfway through. Nothing is charged automatically — this is ' +
        'only a warning.',
      needsReview: true,
    });
  }

  // ── broken machinery
  if (routines.failed > 0) {
    findings.push({
      id: 'routines-failing',
      severity: 'blocked',
      title: `${routines.failed} of your daily ${routines.failed === 1 ? 'jobs failed' : 'jobs failed'}`,
      evidence: `${routines.ran} daily job(s) ran and ${routines.failed} failed.`,
      recommendation: 'I will read the error before the next attempt. Nothing is lost — the work is retried.',
      needsReview: false,
    });
  }

  // ── the daily work never ran at all
  //
  // Without this, a business whose daily marketing is switched off scored a perfect "A quiet day —
  // nothing needed your attention", because every metric it measures is zero and zero reads as
  // calm. The owner reads reassurance while nothing is running and nothing is being produced, which
  // is the most expensive kind of quiet. Zero output is not a quiet day; it is a stopped job.
  //
  // BUT ONLY WHEN ZERO MEANS ZERO. `routines.ran` is a count of rows, and a row that still says
  // `queued` is not evidence of anything: on 2026-11-26, 79 of 80 rows on production were `queued`
  // while every run behind them had already ended, and this finding told the owner their daily
  // marketing "did not run" when the truth was that nothing had written the outcome back. So when
  // the caller supplies a ledger verdict that says the day cannot be read, that verdict speaks
  // instead of the inference — a report may be empty, but it may not be wrong.
  const ledgerSaysUnreadable = Boolean(ledgerDecision && !ledgerDecision.canClaimNothingRan);

  if (routines.ran === 0 && !ledgerSaysUnreadable) {
    findings.push({
      id: 'engine-not-run',
      severity: 'risk',
      title: 'Your daily marketing did not run',
      evidence:
        'It has not run in this period, so nothing was planned, made or reported for you. Every other ' +
        `figure here (${leads.created} enquir${leads.created === 1 ? 'y' : 'ies'}, ${campaigns.active} ` +
        'running ad(s)) follows from that — it is not a quiet day, it is a job that is switched off.',
      recommendation:
        'Switch it on in this tab with "Start it". From the next morning it plans the day, asks you once ' +
        'before spending anything, and reports back.',
      needsReview: false,
    });
  } else if (ledgerDecision && ledgerDecision.verdict !== 'nothing-queued' && ledgerDecision.verdict !== 'settled') {
    /**
     * The honest version of the finding above: the day's own record is not readable yet, or the
     * stored summary of it disagrees with the ledger. Both are reported as what they are, in plain
     * words, and neither is blamed on the owner's settings.
     */
    findings.push({
      id: ledgerDecision.verdict === 'unreconciled' ? 'engine-ledger-unsettled' : 'engine-rollup-stale',
      severity: ledgerDecision.verdict === 'unreconciled' ? 'risk' : 'note',
      title:
        ledgerDecision.verdict === 'unreconciled'
          ? 'My record of this day has not been settled yet'
          : 'The stored summary of this day disagrees with the job ledger',
      evidence: ledgerDecision.sentence,
      recommendation:
        ledgerDecision.verdict === 'unreconciled'
          ? 'Nothing for you to do: I settle these myself, and the report follows once the day can be read. ' +
            'I am not calling it a day that did not run, because I cannot see that yet.'
          : 'Nothing for you to do. I have recorded the disagreement and will write it again from the ledger ' +
            'when the day is summarised.',
      needsReview: false,
    });
  }

  // ── output
  if (content.published === 0 && content.created > 0) {
    findings.push({
      id: 'content-unpublished',
      severity: 'risk',
      title: `${content.created} ${content.created === 1 ? 'piece' : 'pieces'} of content were made but never went out`,
      evidence: `${content.created} ${content.created === 1 ? 'piece was' : 'pieces were'} made and none of them went out.`,
      recommendation: 'Publish them, or tell me which days you want things to go out and I will keep to that.',
      needsReview: true,
    });
  }

  // ── wins, last so the report does not open with a compliment
  if (leads.booked > 0) {
    findings.push({
      id: 'bookings',
      severity: 'win',
      title: `${leads.booked} ${leads.booked === 1 ? 'booking came' : 'bookings came'} in`,
      evidence: `${leads.booked} of the ${leads.created} enquir${leads.created === 1 ? 'y' : 'ies'} turned into a booking.`,
      recommendation: 'This part is working. I will leave it alone and spend the effort somewhere it is not.',
      needsReview: false,
    });
  }
  if (whatsapp.sent > 0 && whatsapp.replied / Math.max(1, whatsapp.sent) >= 0.3) {
    const replies = inTen(whatsapp.replied, whatsapp.sent);
    findings.push({
      id: 'whatsapp-replying',
      severity: 'win',
      title: `${replies} messages got a reply`,
      evidence: `${whatsapp.replied} people replied to ${whatsapp.sent} messages.`,
      recommendation: 'Send more of the same message. People are reading this one.',
      needsReview: false,
    });
  }

  // ── nothing happened at all
  if (!options.quiet && !findings.length) {
    findings.push({
      id: 'quiet-day',
      severity: 'note',
      title: 'A quiet day — nothing needed you',
      evidence:
        `${comparedToLastWeek(leads.created, leads.previousCreated, `enquir${leads.created === 1 ? 'y' : 'ies'}`)}, ` +
        `${campaigns.active} ad(s) running, ${routines.ran} daily job(s) ran, ${credits.balance} credits left.`,
      recommendation:
        'Nothing to fix. If you want more enquiries, that is a decision about money rather than a repair — ' +
        'tell me and I will quote it first.',
      needsReview: false,
    });
  }

  const order: Record<Severity, number> = { blocked: 0, risk: 1, win: 2, note: 3 };
  return findings.sort((a, b) => (order[a.severity] === order[b.severity] ? a.id.localeCompare(b.id) : order[a.severity] - order[b.severity]));
}

/** One line for a push notification or the card header. */
export function summariseFindings(findings: readonly Finding[]): string {
  if (!findings.length) return 'Nothing to report.';
  const blocked = findings.filter((finding) => finding.severity === 'blocked').length;
  const risks = findings.filter((finding) => finding.severity === 'risk').length;
  const wins = findings.filter((finding) => finding.severity === 'win').length;

  const parts: string[] = [];
  if (blocked) parts.push(`${blocked} ${blocked === 1 ? 'thing needs' : 'things need'} you now`);
  if (risks) parts.push(`${risks} worth watching`);
  if (wins) parts.push(`${wins} working`);
  if (!parts.length) parts.push(`${findings.length} note${findings.length === 1 ? '' : 's'}`);
  return `${parts.join(', ')}.`;
}

/**
 * The report as text, for the daily card and for the agent to read back.
 *
 * Capped by severity rather than by count: an owner will read three real problems and will
 * not read thirty.
 */
export function renderReport(metrics: DayMetrics, findings: readonly Finding[], options: { limit?: number } = {}): string {
  const limit = Math.max(1, Math.min(20, options.limit ?? 6));
  // A one-day report should not read "10 Feb to 10 Feb".
  const span =
    metrics.window.from === metrics.window.to
      ? metrics.window.from
      : `${metrics.window.from} to ${metrics.window.to}`;
  const lines: string[] = [`What happened — ${span}`, summariseFindings(findings), ''];
  for (const finding of findings.slice(0, limit)) {
    lines.push(finding.title);
    lines.push(`  the numbers: ${finding.evidence}`);
    lines.push(`  what I would do: ${finding.recommendation}${finding.needsReview ? ' (I will ask you first)' : ''}`);
  }
  if (findings.length > limit) lines.push(`…and ${findings.length - limit} more.`);
  return lines.join('\n');
}
