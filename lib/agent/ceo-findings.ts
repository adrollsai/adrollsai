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
 * "Your cost per lead is high" is an opinion. "₹4,820 spent, 6 leads, ₹803 per lead against
 * ₹310 last week" is a finding. Every entry carries the numbers it was derived from, so the
 * owner can disagree with the conclusion and still trust the arithmetic. That is also what
 * makes the output testable.
 *
 * WHY THE RULES ARE ORDERED THE WAY THEY ARE
 * The list is sorted by what would cost the owner most if ignored: money going out with
 * nothing coming back, then leads nobody called, then drift, then wins. A report whose first
 * line is a compliment gets skimmed.
 */

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
  };
  calls: { placed: number; connected: number; averageSeconds?: number };
  whatsapp: { sent: number; replied: number };
  campaigns: {
    active: number;
    /** Money spent in the window, in paise. */
    spendPaise: number;
    /** Leads attributed to paid campaigns in the window. */
    leads: number;
    /** Average cost per lead last week, in paise, when known. */
    previousCplPaise?: number | null;
  };
  content: { published: number; created: number };
  credits: { balance: number; spentLast7Days: number };
  routines: { ran: number; failed: number };
}

export type Severity = 'blocked' | 'risk' | 'win' | 'note';

export interface Finding {
  id: string;
  severity: Severity;
  /** The headline, in the owner's language. */
  title: string;
  /** The numbers it came from. Never empty. */
  evidence: string;
  /** What we would do — as a suggestion. */
  recommendation: string;
  /** True when acting on this would spend money or reach a customer. */
  needsReview: boolean;
}

const rupees = (paise: number): string => `₹${Math.round((Number(paise) || 0) / 100).toLocaleString('en-IN')}`;

/** Days of runway at last week's burn. null when nothing was spent. */
export function creditRunwayDays(metrics: DayMetrics): number | null {
  const daily = metrics.credits.spentLast7Days / 7;
  if (!Number.isFinite(daily) || daily <= 0) return null;
  return Math.floor(metrics.credits.balance / daily);
}

/** Cost per paid lead in paise, or null when no leads were attributed. */
export function costPerLeadPaise(metrics: DayMetrics): number | null {
  if (metrics.campaigns.leads <= 0) return null;
  return Math.round(metrics.campaigns.spendPaise / metrics.campaigns.leads);
}

/**
 * Turn one day of numbers into ranked findings.
 *
 * Pure. `options.quiet` suppresses the "nothing happened" notes, which a daily digest wants
 * but a chat reply to "how did today go?" does not.
 */
export function analyseDay(metrics: DayMetrics, options: { quiet?: boolean } = {}): Finding[] {
  const findings: Finding[] = [];
  const { leads, calls, whatsapp, campaigns, content, credits, routines } = metrics;

  // ── money going out with nothing coming back
  const cpl = costPerLeadPaise(metrics);
  if (campaigns.spendPaise > 0 && campaigns.leads === 0) {
    findings.push({
      id: 'spend-no-leads',
      severity: 'blocked',
      title: 'You are paying for ads that brought no leads',
      evidence:
        `${rupees(campaigns.spendPaise)} spent across ${campaigns.active} campaign(s) and no leads were ` +
        'attributed to them in this window.',
      recommendation:
        'Pause the campaign until we know whether it is the audience, the creative or the landing page. ' +
        'Pausing is your call — nothing has been changed.',
      needsReview: true,
    });
  } else if (cpl !== null && campaigns.previousCplPaise && cpl > campaigns.previousCplPaise * 1.4) {
    findings.push({
      id: 'cpl-rising',
      severity: 'risk',
      title: `Cost per lead has risen to ${rupees(cpl)}`,
      evidence:
        `${rupees(campaigns.spendPaise)} for ${campaigns.leads} lead(s) = ${rupees(cpl)} each, against ` +
        `${rupees(campaigns.previousCplPaise)} last week.`,
      recommendation:
        'Check which ad is spending without converting before increasing anything. A fresh creative is ' +
        'usually cheaper than a bigger budget.',
      needsReview: true,
    });
  }

  // ── leads nobody touched
  const untouched = Math.max(0, leads.created - leads.contacted);
  if (leads.created > 0 && untouched === leads.created) {
    findings.push({
      id: 'leads-untouched',
      severity: 'blocked',
      title: `${leads.created} lead(s) came in and nobody contacted them`,
      evidence: `${leads.created} created, 0 contacted in this window.`,
      recommendation:
        'These are the cheapest sales you will ever get. Turn on the first-reply automation, or ask me to ' +
        'run it for this batch — it needs your approval before anything is sent.',
      needsReview: true,
    });
  } else if (untouched > 0) {
    findings.push({
      id: 'leads-partly-untouched',
      severity: 'risk',
      title: `${untouched} lead(s) are still waiting for a first reply`,
      evidence: `${leads.created} created, ${leads.contacted} contacted.`,
      recommendation: 'Reply to the rest today; after a day the chance of an answer roughly halves.',
      needsReview: false,
    });
  }

  // ── the phone
  if (calls.placed > 0 && calls.connected === 0) {
    findings.push({
      id: 'calls-not-connecting',
      severity: 'risk',
      title: 'Calls were placed but none connected',
      evidence: `${calls.placed} placed, 0 connected.`,
      recommendation:
        'Usually a timing or number problem, not a script problem. Try a different hour before rewriting ' +
        'anything.',
      needsReview: false,
    });
  } else if (calls.placed > 0) {
    const rate = Math.round((100 * calls.connected) / calls.placed);
    findings.push({
      id: 'call-connect-rate',
      severity: rate >= 40 ? 'win' : 'note',
      title: `${rate}% of calls connected`,
      evidence: `${calls.connected} of ${calls.placed} connected${
        calls.averageSeconds ? `, averaging ${Math.round(calls.averageSeconds)}s` : ''
      }.`,
      recommendation:
        rate >= 40
          ? 'This is working — call the rest of the list the same way.'
          : 'Try a different time of day before changing the script.',
      needsReview: false,
    });
  }

  // ── money running out
  const runway = creditRunwayDays(metrics);
  if (runway !== null && runway <= 3) {
    findings.push({
      id: 'credits-low',
      severity: runway <= 1 ? 'blocked' : 'risk',
      title: runway <= 1 ? 'Credits run out today' : `About ${runway} days of credits left`,
      evidence: `${credits.balance} credits with ${Math.round(credits.spentLast7Days / 7)} spent per day over last week.`,
      recommendation:
        'Top up before the daily work stops mid-run. Nothing is charged automatically.',
      needsReview: true,
    });
  }

  // ── broken machinery
  if (routines.failed > 0) {
    findings.push({
      id: 'routines-failing',
      severity: 'blocked',
      title: `${routines.failed} routine(s) failed`,
      evidence: `${routines.ran} ran, ${routines.failed} failed.`,
      recommendation: 'Open the failed runs and read the error before the next scheduled attempt.',
      needsReview: false,
    });
  }

  // ── the engine never ran at all
  //
  // Without this, a business whose daily routine is switched off scored a perfect "A quiet day —
  // nothing needed your attention", because every metric it measures is zero and zero reads as
  // calm. The owner reads reassurance while nothing is running and nothing is being produced, which
  // is the most expensive kind of quiet. Zero output is not a quiet day; it is a stalled engine.
  if (routines.ran === 0) {
    findings.push({
      id: 'engine-not-run',
      severity: 'risk',
      title: 'Your daily engine did not run',
      evidence:
        `0 routine(s) ran and 0 failed in this window, so nothing was planned, produced or analysed ` +
        `for you. The other zeros on this report (${leads.created} lead(s), ${campaigns.active} ` +
        'campaign(s)) follow from that, not from a genuinely quiet day.',
      recommendation:
        'Turn the daily routine on (CEO tab → Start it). Until it runs, the daily plan, the creative ' +
        'work and this report are all idle.',
      needsReview: false,
    });
  }

  // ── output
  if (content.published === 0 && content.created > 0) {
    findings.push({
      id: 'content-unpublished',
      severity: 'risk',
      title: `${content.created} piece(s) of content were made but nothing was published`,
      evidence: `${content.created} created, 0 published.`,
      recommendation: 'Publish, or tell me the schedule you want.',
      needsReview: true,
    });
  }

  // ── wins, last so the report does not open with a compliment
  if (leads.booked > 0) {
    findings.push({
      id: 'bookings',
      severity: 'win',
      title: `${leads.booked} booking(s) came in`,
      evidence: `${leads.booked} booked from ${leads.created} lead(s) created.`,
      recommendation: 'Keep the current funnel as it is; this is the part that is working.',
      needsReview: false,
    });
  }
  if (whatsapp.sent > 0 && whatsapp.replied / Math.max(1, whatsapp.sent) >= 0.3) {
    findings.push({
      id: 'whatsapp-replying',
      severity: 'win',
      title: 'WhatsApp is getting replies',
      evidence: `${whatsapp.replied} replies to ${whatsapp.sent} message(s) — ${Math.round(
        (100 * whatsapp.replied) / whatsapp.sent,
      )}%.`,
      recommendation: 'Send more of what got replies, and keep the same opening line.',
      needsReview: false,
    });
  }

  // ── nothing happened at all
  if (!options.quiet && !findings.length) {
    findings.push({
      id: 'quiet-day',
      severity: 'note',
      title: 'A quiet day — nothing needed your attention',
      evidence:
        `${leads.created} lead(s), ${campaigns.active} campaign(s) active, ${routines.ran} routine(s) ran, ` +
        `${credits.balance} credits.`,
      recommendation: 'Nothing to fix. If you want more volume, that is a decision rather than a repair.',
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
  if (blocked) parts.push(`${blocked} thing${blocked === 1 ? '' : 's'} need${blocked === 1 ? 's' : ''} you now`);
  if (risks) parts.push(`${risks} to watch`);
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
  const lines: string[] = [`CEO report — ${span}`, summariseFindings(findings), ''];
  for (const finding of findings.slice(0, limit)) {
    lines.push(`[${finding.severity.toUpperCase()}] ${finding.title}`);
    lines.push(`  evidence: ${finding.evidence}`);
    lines.push(`  we suggest: ${finding.recommendation}${finding.needsReview ? ' (needs your approval)' : ''}`);
  }
  if (findings.length > limit) lines.push(`…and ${findings.length - limit} more.`);
  return lines.join('\n');
}
