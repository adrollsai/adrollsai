/**
 * Proves the ops watchdog finds real things, refuses what it should not touch, and can be
 * trusted to write to production.
 *
 * A self-healing system is only worth having if these five properties hold, so each gets a
 * section:
 *
 *   1. IDENTITY — the same broken thing seen 48 times a day is ONE incident, not 48. Without
 *      this the board is noise and the owner stops reading it.
 *   2. GROUPING — 36 runs sharing one error collapse to one root cause, while two genuinely
 *      different errors stay apart. This is the difference between a diagnosis and a list.
 *   3. REFUSAL — every gate in `refusalReason` actually refuses. A guardrail nobody tests is
 *      a comment.
 *   4. REGISTRY — nothing on the repair allowlist can reach money, a customer, or identity,
 *      and no repair may claim a radius the healer would not accept.
 *   5. LIVE — the real detectors run against the real database without throwing, and the full
 *      detect→record→repair→record pipeline completes end to end. A synthetic incident and a
 *      repair that matches zero rows exercise every write path without touching real data,
 *      and the test deletes its own row afterwards.
 *
 *   npm run verify:ops-watchdog
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fingerprintOf, RESOLVE_AFTER_MINUTES } from '../lib/ops/incidents';
import { DETECTORS, errorHead } from '../lib/ops/detectors';
import { repoSnapshotMeta, searchRepo } from '../lib/ops/repo';
import {
  FORBIDDEN_TABLES,
  MAX_REPAIR_ATTEMPTS,
  REPAIRS,
  refusalReason,
  repairFor,
} from '../lib/ops/repairs';
import { heal } from '../lib/ops/healer';
import type { Detection, Incident } from '../lib/ops/types';

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

/** A detection that satisfies the contract, so a test only states the field it cares about. */
function detection(overrides: Partial<Detection> = {}): Detection {
  return {
    class: 'harness-run-lease-expired',
    severity: 'warning',
    title: 'An agent run is stuck',
    evidence: 'Run abc is marked running with an expired lease.',
    suggestedFix: 'Requeue it.',
    blastRadius: 'safe',
    subjectTable: 'harness_runs',
    subjectId: 'abc',
    ...overrides,
  };
}

/** An incident row as the store would return it. */
function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    fingerprint: 'harness-run-lease-expired:abc',
    class: 'harness-run-lease-expired',
    severity: 'warning',
    title: 'An agent run is stuck',
    evidence: 'evidence',
    suggested_fix: 'fix',
    blast_radius: 'safe',
    status: 'open',
    subject_table: 'harness_runs',
    subject_id: 'abc',
    user_id: null,
    occurrences: 1,
    repair_attempts: 0,
    repair_log: [],
    first_seen_at: '2026-11-23T00:00:00.000Z',
    last_seen_at: '2026-11-23T00:00:00.000Z',
    last_repaired_at: null,
    resolved_at: null,
    notified_at: null,
    detail: null,
    ...overrides,
  };
}

// ── 1. identity ──────────────────────────────────────────────────────────────
head('1. One condition, one identity');

const a = detection({ subjectId: 'run-1' });
check('fingerprint is stable across calls', fingerprintOf(a) === fingerprintOf(a), fingerprintOf(a));
check(
  'same class + same subject dedupes despite new evidence text',
  fingerprintOf(a) === fingerprintOf({ ...a, evidence: 'completely different words', title: 'other title' }),
  'title and evidence carry counts and timestamps, so they must not be identity',
);
check(
  'different subjects stay apart',
  fingerprintOf(a) !== fingerprintOf({ ...a, subjectId: 'run-2' }),
);
check(
  'different classes on the same subject stay apart',
  fingerprintOf(a) !== fingerprintOf({ ...a, class: 'other-class' }),
);
check(
  'runs with no subject still get a platform fingerprint',
  fingerprintOf({ ...detection(), subjectId: undefined, subjectTable: undefined }) ===
    'harness-run-lease-expired:platform',
);
check(
  'a fingerprint cannot be made unbounded by a long error head',
  fingerprintOf(detection({ fingerprintKey: 'x'.repeat(5000) })).length <= 270,
  `length ${fingerprintOf(detection({ fingerprintKey: 'x'.repeat(5000) })).length}`,
);

// ── 2. grouping ──────────────────────────────────────────────────────────────
head('2. One bug, many victims');

const sameErrorA = 'Nothing to run: the session has no user message.';
const sameErrorB = 'Nothing to run:   the session has no user message.';
check('whitespace differences collapse to one cause', errorHead(sameErrorA) === errorHead(sameErrorB));

check(
  'ids and timestamps inside an error collapse to one cause',
  errorHead('Render failed for job 6f1d1c2a-1111-2222-3333-444455556666 at 2026-11-23T10:46:09.845719Z') ===
    errorHead('Render failed for job aaaaaaaa-9999-8888-7777-666655554444 at 2026-11-24T01:02:03.000000Z'),
  'otherwise every instance invents its own root cause',
);

check(
  'genuinely different errors stay apart',
  errorHead('Nothing to run: the session has no user message.') !==
    errorHead('No output generated. Check the stream for errors.'),
);
check('an empty error is still a cause', errorHead(null) === '(no error recorded)');

// ── 3. refusal ───────────────────────────────────────────────────────────────
head('3. The guardrails actually refuse');

const requeueRepair = repairFor('harness-run-lease-expired');
check('a registered safe repair is allowed', refusalReason(requeueRepair, incident(), new Date()) === null);
check(
  'an unregistered class is refused',
  refusalReason(null, incident({ class: 'something-new', subject_table: 'harness_runs' }), new Date()) ===
    'not-registered',
  'no wildcard, no default repair',
);
check(
  'a needs_approval incident is never auto-repaired',
  refusalReason(requeueRepair, incident({ blast_radius: 'needs_approval' }), new Date()) === 'radius-mismatch',
);
check(
  'a repair aimed at the wrong table is refused',
  refusalReason(requeueRepair, incident({ subject_table: 'leads' }), new Date()) === 'table-mismatch',
);
check(
  'a forbidden table is refused even when the class matches',
  refusalReason(
    { ...requeueRepair!, table: 'leads' },
    incident({ subject_table: 'leads' }),
    new Date(),
  ) === 'forbidden-table',
);
check(
  'attempts are capped so a flapping incident cannot be repaired forever',
  refusalReason(requeueRepair, incident({ repair_attempts: MAX_REPAIR_ATTEMPTS }), new Date()) ===
    'attempts-exhausted',
  `cap ${MAX_REPAIR_ATTEMPTS}`,
);
check(
  'a just-repaired incident cools down instead of retrying immediately',
  refusalReason(
    requeueRepair,
    incident({ last_repaired_at: new Date(Date.now() - 60_000).toISOString() }),
    new Date(),
  ) === 'cooling-down',
);
check(
  'cooldown does not block a genuinely new occurrence',
  refusalReason(
    requeueRepair,
    incident({ last_repaired_at: new Date(Date.now() - 60 * 60_000).toISOString() }),
    new Date(),
  ) === null,
);

// ── 4. registry integrity ────────────────────────────────────────────────────
head('4. What may be repaired, and what never may be');

const repairs = Object.entries(REPAIRS);
check('the allowlist is not empty', repairs.length > 0, `${repairs.length} repair(s)`);
check(
  'every repair is keyed by its own class',
  repairs.every(([key, repair]) => key === repair.class),
);
check(
  'every repair is safe — nothing that needs approval is on the allowlist',
  repairs.every(([, repair]) => repair.blastRadius === 'safe'),
);
check(
  'every repair declares the columns it writes',
  repairs.every(([, repair]) => repair.columns.length > 0),
  repairs.map(([, repair]) => `${repair.class}(${repair.columns.length})`).join(', '),
);
check(
  'no repair targets a forbidden table',
  repairs.every(([, repair]) => !FORBIDDEN_TABLES.includes(repair.table)),
  FORBIDDEN_TABLES.length + ' forbidden table(s)',
);
check(
  'no repair writes a balance or a ledger column',
  repairs.every(([, repair]) =>
    repair.columns.every((column) => !/^(amount|spent|balance|value|cost|price)$/i.test(column)),
  ),
);
check(
  'money-moving tables are all denied',
  FORBIDDEN_TABLES.includes('credit_transactions') &&
    FORBIDDEN_TABLES.includes('wallet_transactions') &&
    FORBIDDEN_TABLES.includes('wallets') &&
    FORBIDDEN_TABLES.includes('leads'),
);

head('5. Timing invariants');

check(
  'an incident must survive at least two missed sweeps before auto-resolving',
  RESOLVE_AFTER_MINUTES >= 60,
  `resolves after ${RESOLVE_AFTER_MINUTES}m of silence (sweep is every 30m)`,
);
check(
  'every detector explains what it watches, in English',
  DETECTORS.every((detector) => detector.watches.trim().length > 20),
  `${DETECTORS.length} detector(s)`,
);
check(
  'detector ids are unique',
  new Set(DETECTORS.map((detector) => detector.id)).size === DETECTORS.length,
);
check(
  'every registered repair corresponds to a class a detector can emit',
  // The conditional classes live in the detector source; a substring check keeps this honest
  // without pinning the exact string in two places.
  (() => {
    // Resolved from the working directory, not from `import.meta.url`: esbuild emits the
    // bundle at the repo root, so a URL relative to this source file would point one level up.
    const source = readFileSync('lib/ops/detectors.ts', 'utf8');
    return repairs.every(([, repair]) => source.includes(repair.class));
  })(),
);

// The ask console answers from a committed snapshot of the source. If that snapshot is stale
// it will confidently describe code that no longer exists, which is worse than having no
// console at all — so staleness is a gate failure, not a warning.
head('5b. The repo snapshot the ask console reads');

const snapshot = repoSnapshotMeta();
let head0 = '';
try {
  head0 = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  head0 = '';
}
check('the snapshot has files in it', snapshot.fileCount > 500, `${snapshot.fileCount} files, built ${snapshot.generatedAt}`);
check(
  'the snapshot matches HEAD, so answers describe the code that is actually deployed',
  !head0 || head0 === snapshot.commit,
  head0 ? `snapshot ${snapshot.commit} vs HEAD ${head0}` : 'no git available to compare',
);

// Retrieval has to find the right file for the questions the owner will actually ask.
//
// Several entries accept more than one correct path, and that is deliberate: "where are whatsapp
// template messages sent?" has three defensible answers (the templates module, the outbound tool,
// the agent tool), and demanding one exact path would tune the scorer to this test string rather
// than to English. What must hold is that the context handed to the model contains the file that
// does the work.
const retrievalCases: { question: string; anyOf: string[] }[] = [
  {
    question: 'how does the review gate approval work?',
    anyOf: ['lib/agent/review-gate.ts'],
  },
  {
    question: 'where are whatsapp template messages sent?',
    anyOf: ['lib/agent/tools/outbound.ts', 'lib/agent/tools/whatsapp.ts', 'lib/whatsapp/templates.ts'],
  },
  {
    question: 'how do credits get charged for an agent run?',
    anyOf: ['lib/agent/sandbox/credits.ts'],
  },
  {
    question: 'how is the durable agent run queue claimed?',
    anyOf: ['lib/agent/harness/runs.ts'],
  },
  {
    question: 'which tables does the ops watchdog inspect?',
    anyOf: ['lib/ops/detectors.ts', 'lib/ops/types.ts', 'lib/ops/healer.ts'],
  },
  {
    question: 'how does the video render slice avoid the e2b timeout?',
    anyOf: ['lib/agent/tools/hyperframes-render.ts'],
  },
];
for (const { question, anyOf } of retrievalCases) {
  const hits = searchRepo(question, { limit: 8 });
  const rank = hits.findIndex((hit) => anyOf.includes(hit.path));
  check(
    `retrieval surfaces ${anyOf[0]}`,
    rank >= 0,
    rank >= 0 ? `rank ${rank + 1} of ${hits.length} (${hits[rank].path})` : `got ${hits.map((hit) => hit.path).join(', ') || 'nothing'}`,
  );
}
check(
  'an unrelated question retrieves nothing rather than the least-bad file',
  searchRepo('what is the airspeed velocity of an unladen swallow').length === 0,
);

// ── 6 & 7. live ──────────────────────────────────────────────────────────────
head('6. Against the real database');

// The gate must still run for someone without production credentials (CI, a fresh clone), so
// the live half reports SKIP rather than failing. Everything above is pure and always runs.
function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  // Same reason as the detector-source read above: the bundle runs from the repo root.
  if (!existsSync('.env.local')) return env;
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
  }
  return env;
}

const fileEnv = loadEnv();
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.log('SKIP  no Supabase credentials in the environment or .env.local');
} else {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // 6a. The real detectors must not throw. One broken query would blind the watchdog, and
  // silence looks exactly like good news.
  const live = await heal({ supabase, notify: false, applyRepairs: false });
  check(
    'every detector ran against production without throwing',
    live.detectorErrors.length === 0,
    live.detectorErrors.length ? JSON.stringify(live.detectorErrors) : `${Object.keys(live.detected).length} detector(s)`,
  );
  check('the sweep finished inside its route budget', live.durationMs < 60_000, `${live.durationMs}ms`);
  check(
    'incidents were recorded (the board is not silently empty)',
    live.created + live.recurring > 0,
    `${live.created} new, ${live.recurring} recurring`,
  );

  const found = Object.entries(live.detected)
    .filter(([, count]) => count > 0)
    .map(([id, count]) => `${id}=${count}`);
  console.log(`      detected: ${found.length ? found.join(', ') : '(nothing — the app is currently clean)'}`);
  console.log(
    `      awaiting approval: ${live.awaitingApproval}, auto-resolved: ${live.autoResolved}, ` +
      `safe-but-unactionable: ${live.suppressed.length}`,
  );

  // 7. The full pipeline, end to end, on a row that does not exist.
  head('7. Detect → record → repair → record, end to end');

  const marker = `verify-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  // `credit_holds.id` is a uuid column, so the subject has to be a well-formed uuid that
  // simply does not exist. A non-uuid string makes Postgres reject the UPDATE before it can
  // match zero rows, which would test the error path instead of the happy one.
  const syntheticUuid = crypto.randomUUID();
  const syntheticFingerprint = `credit-hold-leaked:${syntheticUuid}`;

  const fakeDetector = {
    id: 'verify-synthetic',
    watches: 'Nothing in production: emits one synthetic detection so the write paths execute.',
    async run(): Promise<Detection[]> {
      return [
        detection({
          class: 'credit-hold-leaked',
          title: 'Synthetic incident for the verify gate',
          evidence: 'Created by verify-ops-watchdog; the repair targets an id that does not exist.',
          blastRadius: 'safe',
          subjectTable: 'credit_holds',
          subjectId: syntheticUuid,
        }),
      ];
    },
  };

  try {
    const sweep = await heal({ supabase, detectors: [fakeDetector], notify: false });
    const entry = sweep.repaired[0];

    check('the synthetic incident was created', sweep.created === 1);
    check('a registered safe repair was applied', entry?.outcome === 'applied', entry?.detail);
    // WHY THIS REPAIR IS A NO-OP HERE, ON PURPOSE
    // `credit_holds.user_id` is a NOT NULL foreign key to `profiles`, and the open-hold sum
    // feeds the tenant's visible balance. Creating a real hold to prove the write would mean
    // briefly subtracting credits from a paying customer's balance every time this gate runs,
    // which is not a thing a test suite is allowed to do. So the repair is pointed at a
    // well-formed uuid that does not exist: every code path runs (the guard, the UPDATE, the
    // log, the status transition) and the UPDATE legitimately matches zero rows.
    //
    // What that leaves to assert is the no-op CONTRACT, which is the part that has to be
    // honest: a repair that changed nothing reports exactly that, and lists no columns.
    check(
      'a repair that changed no rows says so and lists nothing touched',
      Array.isArray(entry?.touched) && entry.touched.length === 0 && /Nothing to do/i.test(entry?.detail || ''),
      entry?.detail,
    );

    const { data: row } = await supabase
      .from('ops_incidents')
      .select('status, repair_attempts, repair_log, blast_radius')
      .eq('fingerprint', syntheticFingerprint)
      .single();

    check('the stored incident moved to repaired', row?.status === 'repaired', `status=${row?.status}`);
    check('the attempt was counted', row?.repair_attempts === 1, `attempts=${row?.repair_attempts}`);
    check(
      'the repair log is append-only evidence with an outcome',
      Array.isArray(row?.repair_log) && row.repair_log.length === 1 && row.repair_log[0]?.outcome === 'applied',
    );

    // A second sweep must not re-repair it: cooldown, then the resolve window.
    const second = await heal({ supabase, detectors: [fakeDetector], notify: false });
    check(
      'a second sweep refuses to repair the same incident again',
      second.repaired.length === 0,
      second.suppressed.map((entry) => entry.reason).join(', ') || 'no repair attempted',
    );

    // A needs_approval class must never be touched, whatever else happens.
    const riskyDetector = {
      id: 'verify-risky',
      watches: 'Nothing in production: emits one detection that must never be auto-repaired.',
      async run(): Promise<Detection[]> {
        return [
          detection({
            class: 'unregistered-dangerous-class',
            title: 'Synthetic risky incident',
            blastRadius: 'needs_approval',
            subjectTable: 'leads',
            subjectId: marker,
          }),
        ];
      },
    };
    const third = await heal({ supabase, detectors: [riskyDetector], notify: false });
    check('a needs_approval incident is never repaired', third.repaired.length === 0);

    const { data: risky } = await supabase
      .from('ops_incidents')
      .select('status')
      .eq('fingerprint', `unregistered-dangerous-class:${marker}`)
      .maybeSingle();
    check('and it is parked in needs_approval for a human', risky?.status === 'needs_approval', `status=${risky?.status}`);
  } finally {
    // The gate leaves nothing behind: the board must describe production, not the test suite.
    const { error } = await supabase
      .from('ops_incidents')
      .delete()
      .in('fingerprint', [
        syntheticFingerprint,
        `unregistered-dangerous-class:${marker}`,
        `verify-synthetic:${marker}`,
      ]);
    check('the gate cleaned up its own rows', !error, error ? String(error.message) : 'deleted');
  }
}

console.log(`\n${'─'.repeat(62)}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('\nThe ops watchdog is not trustworthy until these pass.');
  process.exit(1);
}
console.log('The watchdog finds real faults, refuses what it must not touch, and cleans up after itself.');
