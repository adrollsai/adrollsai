# The ops watchdog — a self-healing loop for Nobogent

Every 30 minutes the app now looks at itself, writes down what is wrong, fixes the small
subset that is provably safe to fix, and tells the owner about everything else.

It exists because of a finding, not a plan. Before a line of it was written, this query was run
against production:

```sql
select left(error, 110) as cause, count(*), min(dead_at), max(dead_at)
from harness_runs where status = 'dead' group by 1 order by 2 desc;
```

```
"Nothing to run: the session has no user message."  |  36  |  2026-11-12  |  2026-11-23
"No output generated. Check the stream for errors." |   1  |  2026-11-17  |  2026-11-17
```

Thirty-six agent runs had been dying for eleven days, every couple of hours, the newest twelve
minutes before that query. Every one recorded `attempts: 0`, so the runner never ran once — the
caller was handing it something unrunnable. Nothing in the product surfaced any of it, because a
dead run only writes an `error` column on a row nobody opens.

That is the class of failure this system is built for: **the app already writes down what went
wrong, and nobody is reading it.**

## The first sweep: what it found, and what was fixed

The watchdog's first three findings were acted on the same day. Two were real bugs; one was the
watchdog being wrong, which is worth recording just as carefully.

**1. Agent runs were dying before they started — fixed in `lib/agent/harness/runner.ts`.**

36 runs over 11 days, all `attempts: 0`, all `"Nothing to run: the session has no user message."`
The cause was not an empty session log — the logs had 6 to 396 events. It was that routines,
WhatsApp approvals and the `run_routine` tool queue a run with their instruction in `run.goal`
and **never record a `user.message`**. The log therefore contained only `run.status` bookkeeping,
which projects to zero model messages, and the runner dead-lettered the run rather than run it.

The fix turns a run's `goal` into the opening user turn when the reconstruction produces nothing,
and writes it to the event log so the transcript shows what was asked for and a resume
reconstructs the same conversation. It sits at the runner rather than at each caller, so every
queueing path is fixed, including ones not written yet. Proven against the two real sessions that
failed: `0 messages before, 1 replayable user turn after` (`npm run verify:runner-goal-seed`, 17
assertions).

**2. Ten unpriced `kie_video` usage rows — written off, with a reason recorded.**

All ten had `user_id = NULL`, `units = NULL` and `cost_inr = 0`: no tenant to charge and no
quantity to price, so there was nothing to recover. Rather than let them sit invisible, they are
now `priced = true`, `state = 'void'` with the write-off note in `detail`. The detector also
learned the difference and no longer reports rows it cannot bill.

**3. Four "overdue" agent events — the watchdog was wrong, and the detector was fixed.**

They were `PENDING_ACTION_APPROVAL` rows: a decision waiting for the *owner*, correctly sitting
in `pending` and closed automatically by `expireStaleApprovals` after 24 hours
(`lib/agent/review-gate.ts`). The detector had also assumed a drainer that this app deliberately
disables — `/api/cron/agent-events` returns early with "Autonomous lead evaluation agent cron is
disabled". It now excludes approval events and says in its evidence that no human is holding the
remaining types up.

**The lesson taken from that third one:** a detector that fires at a 30-minute threshold on a
queue with a 24-hour decision window is a detector that teaches the owner to ignore alerts. The
exclusion is documented in the detector itself, next to the reason.

## Making the class impossible, not just the instance rare

Watching for a fault is the second-best outcome. The best is a schema and a set of guards that
refuse to create it. Two more bugs surfaced while fixing the first three, and both were closed
that way rather than by adding another detector.

**A business could hold several routines, so it ran the same day several times.** The routine-run
idempotency key is `(routine_id, period_key)` — per routine, not per business — so each extra
routine row bought another run for the same day with its own key. Measured on production: **six
runs for one tenant on 2026-11-12**, three on 2026-11-23, two on two other days. Every one of them
died to the unrelated "no user message" bug, which is the only reason it cost nothing; once that
was fixed, those duplicates would have become six real marketing runs.

Closed at three levels:

- `business_routines` now has a partial unique index on `(user_id) WHERE enabled` — the schema
  matches what the code already assumed (`loadRoutine()` picks the oldest row; the CEO tab treats
  the routine as singular).
- `routine_runs` gained `UNIQUE (user_id, period_key)`, because the original key could not see a
  duplicate routine row and therefore could not stop the second run.
- `pickRoutinesToMaterialise` queues **at most one run per business per sweep**, and logs the
  duplicates it ignored rather than discarding them silently — so duplicates are harmless even if
  a future migration relaxes the index.

Both constraints were proven to reject the real duplicates against the live database before being
trusted (`scratch/prove-routine-constraints.mjs`), and it cleaned up after itself.

**A run could be queued with no instruction at all.** `enqueueRun` accepted an empty `goal` and
returned a run that the worker would dead-letter 30 seconds later in another process, with only a
column to show for it — indistinguishable from "the database was busy". It now throws, the runs
API answers `400`, and the reason is logged. A caller bug surfaces at the caller.

The general shape of both fixes, and the rule to apply to the next bug of this kind: **if a
failure mode has a cheap precondition, enforce it at the boundary; if it has a structural cause,
enforce it in the schema.** A watchdog is what you build for the failures you cannot prevent.



## What it does

```
detect ──▶ record ──▶ repair (safe only) ──▶ resolve ──▶ notify
```

| Stage | What happens | Where |
|---|---|---|
| detect | 12 read-only detectors query production | `lib/ops/detectors.ts` |
| record | one incident row per *condition*, deduplicated by fingerprint | `lib/ops/incidents.ts` |
| repair | only classes on the allowlist, only tables and columns they declare | `lib/ops/repairs.ts` |
| resolve | conditions that stopped happening are closed automatically | `lib/ops/incidents.ts` |
| notify | one batched message, at most once per incident per 6 hours | `lib/ops/healer.ts` |

The loop itself is `lib/ops/healer.ts`; the cron entry point is
`app/api/cron/ops-watchdog/route.ts`, scheduled `*/30 * * * *` in `vercel.json`; the record lives
in `public.ops_incidents` (`sql/ops-incidents.sql`).

## What it watches

| Detector | Condition | Auto-fixed? |
|---|---|---|
| `harness-run-lease-expired` | an agent run marked running whose worker lease expired | **yes** — requeued from its checkpoint |
| `harness-run-attempts-exhausted` | that, with every retry already used | no — a human decides |
| `harness-run-dead-lettered` | runs the runner gave up on, grouped by cause | no |
| `harness-run-queued-starved` | queued runs nobody claims | **yes** — made eligible now |
| `harness-runner-silent` | the per-minute runner cron has stopped moving the queue | no |
| `video-task-stuck-processing` | a render the provider abandoned | **yes** — marked failed with the reason |
| `asset-stuck-rendering` | an asset left mid-render | no — it is tenant content |
| `site-build-lock-leaked` | a website build held by a dead worker | **yes** — lock cleared |
| `site-build-attempts-exhausted` | that, with no attempts left | no |
| `credit-hold-leaked` | credits reserved by a hold that expired having spent nothing | **yes** — released |
| `credit-hold-expired-with-spend` | the same, but money moved | no — reconcile first |
| `usage-unpriced` | metered work older than 2h that was never billed, for a real tenant | no |
| `agent-event-backlog` | non-approval agent events past their scheduled time | no |
| `routine-duplicate-rows` | a business holding more than one standing routine | no |
| `app-unreachable` / `app-slow` | the deployed app failing or crawling | no |

Thresholds were chosen against live data, not guessed. Two examples:

- `leads.processing_lock_until` looked like an obvious lock-leak detector. It is not: the code
  that reads it compares against `now` (`lib/automation/call-queue.ts`), so an expired lock is
  already ignored. Shipping that detector would have produced a permanent false positive.
- `video_tasks` is **empty** in production while `assets.status` carries the real render state,
  so the render detectors cover both.

## What it is allowed to fix, and the three gates that decide

Auto-repair is the dangerous part of "self-healing", so safety is enforced, not asserted:

1. **Class allowlist.** A repair must be registered in `REPAIRS` under the exact detector class.
   There is no wildcard and no default repair. An unregistered class is never fixed.
2. **Table and radius agreement.** Each repair declares the one table it may touch and the blast
   radius it claims; the healer refuses on any disagreement with the incident.
3. **Forbidden tables.** 17 tables are denied outright — `credit_transactions`,
   `wallet_transactions`, `wallets`, `transactions`, `leads`, `whatsapp_messages`, `profiles`,
   `organizations`, `campaigns`, `ads` and the rest. Money that moved, a customer, identity, and
   outbound messaging can never appear in a repair.

Plus loop protection: at most **3 attempts** per incident, then it stops and waits for a human; a
**10-minute cooldown** after a successful repair; and every applied repair appends to
`repair_log` with the outcome and the columns it touched.

Every repair is a **state-machine nudge**, never a decision: an expired lease, an already-past
timestamp, a leaked lock, a status that says "Processing" when nothing is processing. Not one
changes money, content, or intent.

## What it deliberately does not do

- **It does not patch code.** It runs on Vercel, where there is no repository and no `git`. Code
  fixes are reported with evidence and the exact file to read.
- **It does not message a customer, spend money, or launch a campaign.** Those arrive as
  `needs_approval` with a suggested fix.
- **It cannot "approve and apply".** There is no button that claims to execute a `needs_approval`
  item, because every item in that state needs a person who understands it. The owner's actions
  are bookkeeping only: dismiss, mark resolved, reopen.

## Using it

```bash
# read the board as JSON (super_admin session cookie)
curl -s https://app.pipixel.io/api/ops/incidents -H "cookie: <your session>" | jq

# read it as something you can actually read
curl -s "https://app.pipixel.io/api/ops/incidents?format=text" -H "cookie: <your session>"

# run a sweep now, detect and record only — no repairs, no messages
curl -s "https://app.pipixel.io/api/cron/ops-watchdog?dryRun=1" -H "authorization: Bearer $CRON_SECRET" | jq

# run it for real
curl -s https://app.pipixel.io/api/cron/ops-watchdog -H "authorization: Bearer $CRON_SECRET" | jq .result
```

### Asking questions about the app

`POST /api/ops/ask` answers from the real code, not from a model's memory of Next.js projects.

```bash
curl -s https://app.pipixel.io/api/ops/ask \
  -H "content-type: application/json" -H "cookie: <your session>" \
  -d '{"question":"why would a video render get stuck in Processing?"}' | jq
```

It works because Vercel has no checkout, so the code travels with the deployment:
`scripts/build-ops-repo-index.mjs` distils every tracked and untracked source file (~1,950 of
them) into `lib/ops/repo-snapshot.json` (~1.2 MB) — path, header comment, exported symbols,
Supabase tables touched, HTTP verbs, and a body keyword signature. `lib/ops/repo.ts` scores a
question against it deterministically — no embeddings, no vector store, nothing to go stale — and
the model is shown the winning files' own explanations with instructions to cite paths and to say
"I could not find that" rather than invent.

The answer also carries the current incident board, so *"why is X failing?"* needs no second call.

**Owner-only.** The snapshot contains internal prompts, pricing logic and every table name. Both
new endpoints check for a `super_admin` profile, exactly like `/api/admin/ledger`.

### Configuration

| Variable | Needed | Purpose |
|---|---|---|
| `CRON_SECRET` | yes (already set) | authorises the sweep; rotation-aware via `CRON_SECRET_NEXT` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes (already set) | the watchdog reads production with it |
| `NEXT_PUBLIC_APP_URL` | yes (already set) | base URL for the reachability probe |
| `OPS_OWNER_USER_ID` | optional | who gets alerted; falls back to the first `super_admin` profile |

## Verification

```bash
npm run verify:ops-watchdog          # 51 assertions, 0 failures
npm run verify:runner-goal-seed      # 17 assertions, 0 failures
npm run verify:routine-once-per-day  # 23 assertions, 0 failures
npm run build:ops-repo-index         # rebuild the snapshot after changing source
```

The gate proves the properties that make this trustworthy rather than the code that makes it run:

- **identity** — the same condition 48 times a day is one incident, not 48
- **grouping** — 36 runs sharing one error collapse to one root cause; different errors stay apart
- **refusal** — every gate above actually refuses, including the forbidden-table and attempts caps
- **registry** — no repair can reach money, a customer or identity, and none writes a balance
- **retrieval** — six real questions land on the file that does the work; an unrelated question
  retrieves nothing instead of the least-bad file
- **snapshot freshness** — every indexed file's line count is re-read from disk and compared to
  what the snapshot recorded, so an answer cannot describe code that has changed. Checked by
  content rather than by comparing the snapshot's commit to `HEAD`: the commit comparison goes red
  on every unrelated commit, and on the very commit that rebuilds the snapshot
- **live** — all 12 detectors run against production without throwing, and the full
  detect→record→repair→record pipeline executes end to end

The live test does not mutate customer data: `credit_holds.user_id` is a foreign key to a real
tenant and the open-hold sum feeds their visible balance, so the gate points the repair at a
well-formed UUID that does not exist. Every write path runs and the UPDATE legitimately matches
zero rows; the test then asserts the honest no-op contract and deletes its own incidents.

## Adding a detector

1. Write it in `lib/ops/detectors.ts`: read-only, returns `Detection[]`, `blastRadius:
   'needs_approval'` unless you can prove a wrong fix costs only a retry.
2. Add it to `DETECTORS`.
3. `npm run build:ops-repo-index && npm run verify:ops-watchdog`.

Group by cause rather than enumerating rows when a condition can fire many times. Report only,
unless a repair is genuinely safe — a detector that needs no fix is still worth having, because
the owner knowing is the point.

## Adding a repair

Only if all of these are true: it is reversible, it moves no money, it reaches no customer, it
changes no content, and it only removes an obstacle that has already expired. Then register it in
`REPAIRS` with the exact `table` and `columns` it writes, re-assert the condition inside the
`UPDATE`, and report `touched: []` when it changed nothing.

If you cannot say all of that, the answer is `blastRadius: 'needs_approval'`.

## Known gaps

- **No 5xx rate, no runtime-log reading.** Vercel's log API is not wired in; the reachability
  probe only notices a broken or slow app, not a single failing route. `VERCEL_TOKEN` and
  `VERCEL_PROJECT_ID` are already in the environment, so this is the obvious next detector.
- **No code patching, by decision.** See above — it would need a checkout and a deploy pipeline.
- **The 36 dead runs are reported, not fixed.** The cause is a caller passing a run with no user
  message; that is a code fix in the routine path, and the incident carries the evidence for it.
- **`lib/automation/credit-reconcile.ts` is not called by anything.** It can detect a hold whose
  `spent` disagrees with the ledger — exactly the bug class a watchdog should be watching — but no
  sweep runs it. Wiring it in per-tenant is the highest-value follow-up here.
