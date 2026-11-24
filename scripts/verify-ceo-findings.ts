/**
 * Proves the CEO's daily report says only what the numbers support, and never acts.
 *
 * The failure modes worth pinning are the ones that make a report untrustworthy:
 *
 *   - a finding with no evidence, which is an opinion wearing a number
 *   - the wrong severity, so a real problem reads like a footnote
 *   - a WIN being harmless is fine; a "win" being the first line is not — the report must
 *     open with what costs money
 *   - the report claiming it will act, when it must only suggest
 *   - a quiet day producing an empty screen instead of a sentence
 *
 *   npm run verify:ceo-findings
 */
import {
  analyseDay,
  costPerLeadPaise,
  creditRunwayDays,
  renderReport,
  summariseFindings,
  type DayMetrics,
  type Finding,
} from '../lib/agent/ceo-findings';

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

/** A healthy day: leads arriving, calls connecting, content going out, credits fine. */
function healthy(): DayMetrics {
  return {
    window: { from: '2026-02-01', to: '2026-02-02' },
    leads: { created: 12, contacted: 12, replied: 5, booked: 2, lost: 1 },
    calls: { placed: 10, connected: 6, averageSeconds: 84 },
    whatsapp: { sent: 20, replied: 9 },
    campaigns: { active: 2, spendPaise: 240_000, leads: 8, previousCplPaise: 28_000 },
    content: { published: 3, created: 3 },
    credits: { balance: 4_000, spentLast7Days: 700 },
    routines: { ran: 3, failed: 0 },
  };
}

const ids = (findings: readonly Finding[]) => findings.map((finding) => finding.id);

head('1. The arithmetic the report depends on');

check(
  'cost per lead is spend divided by attributed leads',
  costPerLeadPaise(healthy()) === 30_000,
  `₹${(costPerLeadPaise(healthy()) ?? 0) / 100}`,
);
check(
  'cost per lead is null when no lead was attributed, not infinity or zero',
  costPerLeadPaise({ ...healthy(), campaigns: { ...healthy().campaigns, leads: 0 } }) === null,
  'null, so the caller must decide',
);
check(
  'runway is balance divided by daily burn',
  creditRunwayDays({ ...healthy(), credits: { balance: 4_000, spentLast7Days: 700 } }) === 40,
  `${creditRunwayDays(healthy())} days`,
);
check(
  'runway is null when nothing has been spent, rather than "infinite"',
  creditRunwayDays({ ...healthy(), credits: { balance: 4_000, spentLast7Days: 0 } }) === null,
  'null',
);

head('2. A healthy day reports wins, not alarms');

{
  const findings = analyseDay(healthy());
  check(
    'no blocked findings on a healthy day',
    findings.every((finding) => finding.severity !== 'blocked'),
    ids(findings).join(', '),
  );
  check(
    'bookings and a good connect rate are reported as wins',
    findings.some((finding) => finding.id === 'bookings' && finding.severity === 'win') &&
      findings.some((finding) => finding.id === 'call-connect-rate' && finding.severity === 'win'),
    ids(findings).join(', '),
  );
  check(
    'the summary line leads with what is working when nothing is wrong',
    /working/.test(summariseFindings(findings)),
    summariseFindings(findings),
  );
}

head('3. Money going out with nothing back is BLOCKED, not a note');

{
  const spendOnly = analyseDay({
    ...healthy(),
    leads: { created: 0, contacted: 0, replied: 0, booked: 0, lost: 0 },
    campaigns: { active: 2, spendPaise: 180_000, leads: 0, previousCplPaise: null },
  });
  check(
    'spend with no leads is the first thing reported',
    spendOnly[0]?.id === 'spend-no-leads' && spendOnly[0]?.severity === 'blocked',
    spendOnly[0]?.title ?? 'nothing',
  );
  check(
    'it quotes the spend rather than saying "high cost"',
    /₹1,800/.test(String(spendOnly[0]?.evidence)),
    spendOnly[0]?.evidence ?? '',
  );
  check(
    'acting on it needs approval, because pausing a campaign is a real change',
    spendOnly[0]?.needsReview === true,
    'needsReview',
  );
}

head('4. Leads nobody touched is the loudest thing in the report');

{
  const ignored = analyseDay({
    ...healthy(),
    leads: { created: 9, contacted: 0, replied: 0, booked: 0, lost: 0 },
  });
  check(
    'a batch with zero contact is blocked',
    ignored.some((finding) => finding.id === 'leads-untouched' && finding.severity === 'blocked'),
    ids(ignored).join(', '),
  );
  check(
    'and says how many are waiting',
    // Plain wording now: "9 people asked and nobody replied". The count and the fact that nobody
    // answered both have to be in the headline for it to be actionable.
    /\b9\b/.test(String(ignored.find((finding) => finding.id === 'leads-untouched')?.title)) &&
      /replied/.test(String(ignored.find((finding) => finding.id === 'leads-untouched')?.title)),
    ignored.find((finding) => finding.id === 'leads-untouched')?.title ?? '',
  );
  const partial = analyseDay({ ...healthy(), leads: { created: 9, contacted: 6, replied: 2, booked: 0, lost: 0 } });
  check(
    'a partly-contacted batch is a risk, not a block',
    partial.some((finding) => finding.id === 'leads-partly-untouched' && finding.severity === 'risk'),
    ids(partial).join(', '),
  );
}

head('5. Drift is caught before it becomes a loss');

{
  const expensive = analyseDay({
    ...healthy(),
    campaigns: { active: 1, spendPaise: 480_000, leads: 6, previousCplPaise: 30_000 },
  });
  check(
    'cost per lead rising by more than 40% is a risk',
    expensive.some((finding) => finding.id === 'cpl-rising' && finding.severity === 'risk'),
    expensive.find((finding) => finding.id === 'cpl-rising')?.evidence ?? 'not caught',
  );
  check(
    'it compares against last week rather than against nothing',
    /the week before|last week/.test(String(expensive.find((finding) => finding.id === 'cpl-rising')?.evidence)),
    expensive.find((finding) => finding.id === 'cpl-rising')?.evidence ?? '',
  );
  const steady = analyseDay({ ...healthy(), campaigns: { active: 1, spendPaise: 300_000, leads: 10, previousCplPaise: 30_000 } });
  check(
    'a steady cost per lead does NOT raise an alarm',
    !steady.some((finding) => finding.id === 'cpl-rising'),
    'no false positive',
  );
}

head('6. Broken machinery and running-out money');

{
  const failing = analyseDay({ ...healthy(), routines: { ran: 4, failed: 2 } });
  check(
    'failed routines are blocked',
    failing.some((finding) => finding.id === 'routines-failing' && finding.severity === 'blocked'),
    ids(failing).join(', '),
  );
  const low = analyseDay({ ...healthy(), credits: { balance: 200, spentLast7Days: 1_400 } });
  check(
    'credits with one day of runway are blocked, not a note',
    low.some((finding) => finding.id === 'credits-low' && finding.severity === 'blocked'),
    low.find((finding) => finding.id === 'credits-low')?.title ?? 'not caught',
  );
  const lowish = analyseDay({ ...healthy(), credits: { balance: 600, spentLast7Days: 1_400 } });
  check(
    'three days of runway is a risk',
    lowish.some((finding) => finding.id === 'credits-low' && finding.severity === 'risk'),
    lowish.find((finding) => finding.id === 'credits-low')?.title ?? 'not caught',
  );
  check(
    'top-up is never charged automatically — it needs approval',
    low.find((finding) => finding.id === 'credits-low')?.needsReview === true,
    'needsReview',
  );
}

head('7. The report never claims to have done anything');

{
  const badMetrics: DayMetrics = {
    ...healthy(),
    leads: { created: 9, contacted: 0, replied: 0, booked: 0, lost: 0 },
    campaigns: { active: 2, spendPaise: 180_000, leads: 0, previousCplPaise: null },
    routines: { ran: 2, failed: 1 },
    credits: { balance: 100, spentLast7Days: 1_400 },
  };
  const everything = analyseDay(badMetrics);
  check(
    'no recommendation is empty or a bare statement',
    everything.every((finding) => finding.recommendation.length > 20),
    `${everything.length} findings`,
  );
  check(
    'anything that would spend money or message a customer is marked for approval',
    // The invariant that matters: a suggestion the owner can wave through must not be one
    // that quietly moves money.
    ['spend-no-leads', 'cpl-rising', 'leads-untouched', 'credits-low', 'content-unpublished'].every((id) => {
      const finding = everything.find((entry) => entry.id === id);
      return !finding || finding.needsReview === true;
    }),
    everything.filter((finding) => finding.needsReview).map((finding) => finding.id).join(', '),
  );
  const text = renderReport(badMetrics, everything);
  check(
    'the rendered report marks the items that need approval',
    /I will ask you first/.test(text),
    'approval markers present',
  );
  check(
    'and it is a report, not a plan of record — no "I have paused" language',
    !/\bI (have )?(paused|launched|spent|sent|deleted|changed)\b/i.test(text),
    'no past-tense action claims',
  );
}

head('8. Ordering and reading');

{
  const mixed = analyseDay({
    ...healthy(),
    leads: { created: 5, contacted: 0, replied: 0, booked: 3, lost: 0 },
    routines: { ran: 3, failed: 2 },
  });
  const severities = mixed.map((finding) => finding.severity);
  const order: Record<string, number> = { blocked: 0, risk: 1, win: 2, note: 3 };
  check(
    'blocked comes before risk, and wins come before notes',
    severities.every((severity, index) => index === 0 || order[severities[index - 1]] <= order[severity]),
    severities.join(' → '),
  );
  check(
    'the report does not open with a compliment',
    mixed[0].severity === 'blocked' || mixed[0].severity === 'risk',
    `${mixed[0].severity}: ${mixed[0].title}`,
  );
}

head('9. A quiet day is still a report');

{
  const quiet = analyseDay({
    window: { from: '2026-02-01', to: '2026-02-02' },
    leads: { created: 0, contacted: 0, replied: 0, booked: 0, lost: 0 },
    calls: { placed: 0, connected: 0 },
    whatsapp: { sent: 0, replied: 0 },
    campaigns: { active: 0, spendPaise: 0, leads: 0 },
    content: { published: 0, created: 0 },
    credits: { balance: 3_000, spentLast7Days: 0 },
    // The engine RAN and found nothing to do — that is what a quiet day means now.
    routines: { ran: 1, failed: 0 },
  });
  check(
    'a day with nothing in it says so instead of showing a blank',
    quiet.length === 1 && quiet[0].id === 'quiet-day' && quiet[0].severity === 'note',
    quiet[0]?.title ?? 'nothing',
  );
  check(
    'and it still carries evidence',
    /0 enquir/.test(String(quiet[0]?.evidence)) && /3,000|3000/.test(String(quiet[0]?.evidence)),
    quiet[0]?.evidence ?? '',
  );

  // Zero output is not calm, it is a stalled engine. This used to read as a perfect "nothing
  // needed your attention" while the daily routine had never run at all — which is exactly what
  // the owner saw on his own account.
  const stalled = analyseDay({
    window: { from: '2026-02-01', to: '2026-02-02' },
    leads: { created: 0, contacted: 0, replied: 0, booked: 0, lost: 0 },
    calls: { placed: 0, connected: 0 },
    whatsapp: { sent: 0, replied: 0 },
    campaigns: { active: 0, spendPaise: 0, leads: 0 },
    content: { published: 0, created: 0 },
    credits: { balance: 24_792, spentLast7Days: 0 },
    routines: { ran: 0, failed: 0 },
  });
  check(
    'an engine that never ran is a stalled engine, not a quiet day',
    stalled.some((finding) => finding.id === 'engine-not-run' && finding.severity === 'risk'),
    stalled[0]?.title ?? 'nothing',
  );
  check(
    'and the quiet-day filler is gone in that case',
    !stalled.some((finding) => finding.id === 'quiet-day'),
  );
  check(
    'it names the cause and the fix',
    /has not run/.test(String(stalled[0]?.evidence)) && /Start it/.test(String(stalled[0]?.recommendation)),
    String(stalled[0]?.recommendation ?? '').slice(0, 60),
  );
  check(
    'asking for a quiet report to be silent gives an empty list, not a filler line',
    analyseDay(
      {
        window: { from: 'a', to: 'b' },
        leads: { created: 0, contacted: 0, replied: 0, booked: 0, lost: 0 },
        calls: { placed: 0, connected: 0 },
        whatsapp: { sent: 0, replied: 0 },
        campaigns: { active: 0, spendPaise: 0, leads: 0 },
        content: { published: 0, created: 0 },
        credits: { balance: 0, spentLast7Days: 0 },
        // The engine ran, so there is genuinely nothing to say. `quiet` suppresses the filler note
        // only — it must never suppress the stalled-engine warning, which is tested below.
        routines: { ran: 1, failed: 0 },
      },
      { quiet: true },
    ).length === 0,
    'quiet: true',
  );
  check(
    'but a stalled engine is never silenced by quiet: true',
    analyseDay(
      {
        window: { from: 'a', to: 'b' },
        leads: { created: 0, contacted: 0, replied: 0, booked: 0, lost: 0 },
        calls: { placed: 0, connected: 0 },
        whatsapp: { sent: 0, replied: 0 },
        campaigns: { active: 0, spendPaise: 0, leads: 0 },
        content: { published: 0, created: 0 },
        credits: { balance: 0, spentLast7Days: 0 },
        routines: { ran: 0, failed: 0 },
      },
      { quiet: true },
    ).some((finding) => finding.id === 'engine-not-run'),
    'a real problem is not a filler line',
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
