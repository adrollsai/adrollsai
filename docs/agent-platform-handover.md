# Agent platform — handover

State of the P1–P10 programme. Read this before touching anything; every claim
here was verified by a gate or a live call, not inferred.

## Committed and green

| Commit | Branch | What |
|---|---|---|
| `717302d1` | `p1-runner-integration` | **P1** durable sandbox runner wired to E2B + Supabase + credits + R2 |
| `1c936ba2` | `p2-model-router` | **P2** every media-model id from the registry, retry-then-fallback |
| `d526f4c6` | `p2b-tts-verified` | P2 follow-up: 3.8 TTS model verified against kie live |
| `1558a075` +3 | `p3-video-skill` | **P3** the video skill, the film, and the mastering pass |
| `7f0ec158` +1 | `p5-images` | **P5** full-image only, 10 live images, 4 ratios |
| `ed4fad89` | `p6-pages-edit` | **P6** a page edit changes one section, and proves it |
| `2ea8d230` | `p7-journey` | **P7** the per-campaign lead journey |
| `fbdc7c1e` | `p7b-journey-handoff` | P7 follow-up: a blocked step hands the lead to a human |
| `3769dbda` | `p8-scraping` | **P8** polite scraper: robots, rate limits, SSRF, R2 cache |
| `3ddf8fb1` | `p4-reverse-mp4` | **P4** the reverse skill: measure an MP4, rebuild it as a video-skill film |
| `32984620` | `p9-credits` | **P9** plan table, one grant path, reconciliation, read-only admin ledger |
| `6520daf0` | `p10-onboarding-spine` | **P10** the onboarding spine, and a flag that is no longer trusted |
| `fb627419` | — | Session baseline (payments, agent UI, STT, CRM live updates) |

Each package has its own commit on its own branch so it can be reverted alone.
Nothing has been pushed to `adrollsai`.

Every gate, at `6520daf0`:

```bash
node scripts/agent-selftest.mjs          # 78 assertions   P1
npm run verify:media-models              # 35 assertions   P2
npm run verify:video-skill               # 93 assertions   P3
npm run verify:reverse-skill             # 85 assertions   P4
npm run verify:image-skill               # 115 assertions  P5
npm run verify:pages                     # 47 assertions   P6
npm run verify:journey                   # 93 assertions   P7
npm run verify:scraping                  # 111 assertions  P8
npm run verify:credits                   # 67 assertions   P9
npm run verify:onboarding                # 45 assertions   P10
npx tsc --noEmit                         # filter TS6053 while a dev server runs
NODE_OPTIONS=--max-old-space-size=8192 npm run build   # EXIT 0
```

All of them are pure: no vendor, no browser, no render, no database. That is the
point — they pin contracts, not integrations. The live proofs are listed under each
package below.

## Facts established by live calls (do not re-derive)

**TTS.** `google/gemini-3-8-flash-tts` is real. `createTask` → `code 200`, task
`SUCCESS` in ~5 s, real `.wav` returned. An old comment in this repo claimed
"there is no 3.8 TTS entry" — that was wrong and has been removed; do not
restore it. Two payload traps, both proven:
- `input.speakers[]` is **required** (a flat text payload returns
  `code 500 "speakers is a required parameter"` — note it names a parameter,
  which is how you know the model id itself resolved).
- a non-empty per-speaker `style` is rejected with **HTTP 422**; keep `style: ''`
  and put sound-design direction in `scene`.

**Disk.** Renders refuse under ~2 GB free (trap 6) and one film's plate working
set is 1.5–2.5 GB. This machine: **C: 2.6 GB free, D: 145 GB free.** Build video
projects under `D:\nobo-renders` and point `TEMP`/`TMPDIR` at `D:\nobo-tmp` for
the render subprocess. Do not bulk-delete `%TEMP%`.

**HyperFrames** `npx hyperframes@0.9.43` is reachable. `render [DIR] -o <out>`;
`-q looks` is CRF 16; `check --json` must report 0 errors.

## The beats → scenes contract (from the delivered reference film)

Reference: `C:\Users\Adrolls\Desktop\Nobo Native App\gnr-homes-tricity`
(46.48 s, 1080×1920). Generators: `…\scratch\gnr\`.

```jsonc
{ "total": 46.48,
  "vo": [{ "id": "p01", "start": 0.62, "dur": 2.66 }, …],   // measured, silencedetect
  "sceneList": { "s0": {"start":0,"dur":0.5}, "s1": {"start":0.5,"dur":5.51}, … },
  "s1": { "dur":5.51, "cut":3.1, "label":0.15, "h1":0.3, "h2":1.31,
          "out":2.52, "labelOut":2.62, "logo":2.92, "hair":4.02, "talk":4.1, "end":5.5 } }
```

Timing is **measured**, never hand-typed. `s0` is a 0.5 s **plate-only lead-in**,
which is what makes trap 1 (t=0 scenes never reveal `.clip` overlays) a
non-issue by construction.

## Decisions that are final (section 0 of the brief)

Image `gpt-image-2-5-flare-text-to-image`; with a reference
`gpt-image-2-5-flare-image-to-image`; fallback `google/nano-banana-2`. Video
`grok-imagine-video-1-5-preview` (image-to-video, ≤6 s), fallback
`grok-imagine/image-to-video`. Voice `google/gemini-3-8-flash-tts`, fallback
`google/gemini-2-5-pro-tts`. Music `ai-music-api/generate`, `input.model =
'V6_MINI'`. **No YouTube sourcing**, ever. Credits: hold → charge per completed
step → refund the unspent reserve. Ask before spending (Plan Card). Voiceover
Hinglish by default; on-screen text English only.

## Package status

- **P1 done.** Adapters in `lib/agent/sandbox/{e2b,store,credits,artefact,pipeline,log}.ts`.
  `agent_runs` migration applied to production (1 table, 3 indexes, 1 policy).
  Exactly-once per `(run_id, step)` rides on `credit_transactions_ref_uniq` —
  **no new money code**. `settle()` exists because a step skipped on an existing
  artefact would otherwise hold credits until TTL.
- **P2 done.** 14 application files migrated (the brief said five). Guard fails on
  any inline kie id in `app/ components/ lib/ mobile/`. `withMediaFallback` retries
  once only for 524/timeout/429/5xx and falls back once, logging the reason.
  Fixed two real bugs: `estimateCredits('video', n)` returned **0** (so the
  pre-spend reservation reserved nothing), and `media_studio` sent reference-image
  edits to a text-to-image model.
- **P3 done.** `lib/agent/tools/skills/video/{beats,timing,emit,index}.ts` + README.
  The three bugs that mattered were all invisible to the linter: a sub-composition
  brand bug painting a cream slab over a third of the frame, type clipped past the
  safe box, and colour-bar plates. Fixed, and the zero-size-bbox finding is now a
  **fatal** error rather than a warning. Loudness: the render measured −31.6 LUFS
  while the `audio` section reported 0 errors, so the project now emits its own
  `master.sh` (linear `loudnorm` to −16 LUFS / TP −1.5, `-c:v copy`, re-measures
  the file on disk and exits 3/4). Live: `D:\nobo-renders\proof\proof-toolchain-9x16-06f40b79\proof.mp4`
  — 31.97 s, 1080×1920, 30 fps, `check` 0 errors **0 warnings**, 16/16 distinct
  frames, `final.mp4` −16.0 LUFS / −10.6 dB peak with the video md5 unchanged.
- **P4 done.** `lib/agent/tools/skills/reverse/{analyse,spec,rebuild,compare,index}.ts`
  + README. Measures a reference film (cuts, shots, palettes, where type sits, and
  the voice up a `silencedetect` noise-floor ladder), writes a SPEC the audit
  cannot let invent a figure, and rebuilds the film as a `beats.json` the **video
  skill's own `parseBeats` validates** — it never renders and never calls a vendor,
  so a reverse costs only the render (`estimateReverseCredits().media === 0`).
  Copy is a marked blank (`WORD WORD`), because there is no OCR and no transcript
  in this pipeline; the words are an open question for a human. Two bugs found and
  fixed: `emit.ts` carried unescaped backticks inside the `master.sh` template
  literal so the module did not compile at all, and a reference with no measurable
  voice crashed inside `parseBeats` — it now throws `ReverseRebuildError` naming
  the measurement's own reason. `verify-video-skill` also gained two imports it had
  been missing, so an assertion that never compiled now runs (92 → 93).
  **Not proven:** no render and no live ffmpeg run through the skill;
  `scripts/reverse-live-proof.ts` is the harness that does it.
- **P5 done.** Full-image only (background+HTML-overlay paths deleted, banned by
  section 0). Live: 10 images, 4 ratios, 5 with a reference image, 80 credits,
  written to `D:\nobo-images\`. Inspected `3x4-6340c0c4.png` — type painted into the
  artwork and the price ₹1.45 Cr matches the facts, so the model is not inventing.
- **P6 done.** `lib/site/page-sections.ts`. The old edit path sent the whole page to
  a model with an instruction and took the whole page back, so "change the phone
  number" could re-pick the hero image and re-word the headline, for a credit, with
  no way to show what else moved. Now a page is split into named sections (HTML
  comment markers, which survive a template or a model round trip), a legacy page is
  ADOPTED at its landmarks rather than regenerated, and an edit replaces one section
  while `verifyEdit` **fails** if any other section, the head, the scripts or a
  section's existence changed. `replaceTextOnce` refuses zero matches and refuses
  several ("Call Now" appears three times on the fixture page and five on a real
  one) instead of guessing which one you meant.
  The industry bug is fixed here too: real-estate-only sections (floor plans,
  specifications) are dropped for every other industry **including an unknown one**,
  and the offerings heading comes from `industryVocabulary` — that is the bug that
  gave a film academy a property-listing site. `stripDisallowedSections` runs on
  whatever produced the page, so it catches a template or a model too.
  Four bugs in my own module were found by writing the gate: inter-section
  whitespace folded into the preamble so pages did not round-trip, `<main>` treated
  as content, the first edit on an adopted page looking like a change to the last
  section, and stripping the trailing sections leaving their separator behind.
  **Not proven:** no live page read from `landing_pages` and no browser render.
  **Not wired:** `POST /api/landing-page/generate` still does its whole-page edit.
  Switching that route to the surgical path changes what the editor does and that it
  costs no model and no credit, so it needs its own change and its own UI decision.
- **P7 done.** `lib/automation/{journey,journey-store,lead-message-policy,calling-script}.ts`.
  First reply, T+1h, T+1d, opt-out and handoff, with a refused send recorded as
  blocked with the channel error rather than silently dropped. The follow-up
  (`fbdc7c1e`) made a blocked step a HANDOFF rather than a dead end: the lead is
  flagged, the owner is told exactly once, the remaining steps are cancelled, and the
  reason is logged.
- **P8 done.** `lib/agent/scraping/{robots,rate-limit,fetch,extract,cache,index}.ts`
  + the `scrape` skill. Live: 3 sources (14 rows), a real 429 with delays stepping
  749 → 1384 ms, `httpbin.org/deny` refused with **0 requests**, and a real R2 cache
  exercising 1 PUT / 1 hit. `agent_scrape_definitions` is applied to production.
- **P9 done.** `lib/automation/{credit-tiers,credit-grants,credit-reconcile}.ts` and
  `app/api/admin/ledger/route.ts`. The plan table is in paise and encodes the final
  decision (**₹9,999 = 5,000 credits**, ₹2.00/credit; Starter ₹4,999 = 1,500 at
  ₹3.33; Scale ₹24,999 = 15,000 at ₹1.67, so a bigger plan is always a better rate).
  `tierCapacity()` reads `CREDIT_COSTS` rather than copying it, so "5,000 credits"
  is also 500 images / 1,500 s of video / 1,000 call minutes and cannot drift from
  the price list. `tierTableProblems()` refuses a table with a misplaced zero
  (credits per ₹100 must stay inside [5, 200]) — my first draft of the table failed
  its own rate rule, which is how the guard earned its place.
  One grant path: `paymentRef`/`topUpRef`/`trialRef` build the idempotency key from
  the event's identity and never from the clock; `grantTierOnce` refuses an unknown
  plan and a payment that does not match the plan, then delegates to
  `billing.grantCreditsOnce`, so the atomic path is unchanged.
  Reconciliation compares the two independent records of the same event — the
  hold's own `spent` counter and the ledger rows that name the run — and the
  property it guards is that **a failed run nets exactly 0** (verdict
  `no-movement`, nothing still reserved). Disagreement is a `mismatch` with the gap
  in credits named, because that is the bug class that makes a balance drift away
  from a customer's receipts. **Not proven:** no live database read or write and no
  Razorpay call; the grant path is driven against a fake wallet that reproduces
  `grant_credits_once`'s NULL-means-duplicate contract.
- **P10 done.** `lib/automation/onboarding-spine.ts` and
  `app/api/onboarding/status/route.ts`. One ordered spine of nine steps (five
  blocking), each with the reason the agent needs it and the route that completes
  it, and `evaluateSpine()` recomputes readiness **from the data**. Read the next
  bullet before you trust any flag.
  Two rules it enforces: an unknown industry gets neutral wording and **never**
  property wording, and `credits: null` is "could not be read", not zero.
  `nextQuestion()` asks about the first blocker only, so the agent asks instead of
  failing inside a vendor call.
  **Not proven:** no live read against production; the offering/run counts are the
  only new queries and they are exact-count HEAD requests.
  Deliberately untouched: `app/dashboard/onboarding/page.tsx` (114 KB) and
  `app/api/onboarding/complete/route.ts` (32 KB) still work as before — wiring the
  page to read `GET /api/onboarding/status` is a UI change and belongs to its own
  package.

## `profiles.onboarding_completed` is a claim, not a fact

A wizard sets it, and then the data can be edited underneath it. P10 reads the flag
only to cross-check it, and reports both directions as a discrepancy:

- flag `true` while blocking steps are still missing → not ready, discrepancy logged;
- flag `false` while every step is satisfied → ready, discrepancy logged (do not make
  the owner redo the wizard to set a flag).

There is no `profiles.owner_id` column. A team member's workspace owner comes from
`resolveBillingOwner` (`parent_id` → `agency_id` → `id`), which is also what the
wallet uses, so the spine and the balance cannot disagree about whose workspace it
is.

## KNOWN DEFECT: the reverse rebuild can render as one long end card

Found by looking at frames, not by any gate. This is the P3 lesson repeating: a film
can pass every check and still be wrong on screen.

**What happens.** Reverse a reference that measures as very few shots and the rebuild
can turn its only content scene into the end card. `kindFor()` returns `'endcard'`
whenever a scene is last, and the emitter draws a card's blocks INSTEAD of a scene's
beat lines — so the beats are measured, counted, timed, and never seen. The result is
a brand card with placeholder digits over the plate for the whole runtime.

**The evidence.** `node scripts/reverse-live-proof.ts --end 9` against
`D:\nobo-renders\proof\proof-toolchain-9x16-06f40b79\final.mp4` (a real 31.98 s
1080×1920 film):

- measurement is honest: 2 shots, 3 type boxes, 10 onsets, `check` 0 errors, SPEC
  audit 203 figures and 0 unaccounted, runtime 0.00 s drift, beat count 10/10
- the render is wrong: the contact sheet at
  `D:\nobo-renders\reverse\final-reverse\contact-sheet.png` shows the reference
  playing "HOMÈ OR PROPERTY?" and "EVERY BUDGET" over the city while the rebuild shows
  "BRAND UNKNOWN / TAGLINE UNKNOWN / 0000000000 / 0000000001" at every one of the five
  compared timecodes
- a raw frame from the render (`-ss 2.0`) confirms it: the plate is playing underneath
  and the card's type is drawn over it from ~1.9 s
- `timing.json` explains why: the film is `s0` (0.5 s) + `s1` (31.48 s, kind
  `endcard`). There is no content scene at all.

**Why it is not fixed here.** The obvious fix — never let a scene with beats be the
end card, and give the card its own beatless scene — was implemented and reverted. It
is correct in principle but it ADDS duration, and `fitTimingToRuntime` then tightens
the inter-line gap to reach the reference's runtime until a beat drops below the
readability floor (`s1/p02: "WORD WORD WORD" is on screen 1.17s but needs 1.4s`).
Paying for the card by making the words unreadable is not a fix.

**What the fix needs.** The card's duration has to come from the reference's own
measured tail — the silence between the last onset's end and the end of the film —
rather than being a constant added on top, so the total is unchanged and no beat is
squeezed. If the reference has no measurable tail, the honest outcome is to say so and
report runtime drift, not to compress the voice.

**Until then:** treat a reverse of a low-shot-count reference as needing a human look
at the contact sheet before it is delivered. The measurement, the SPEC, the beats file
and the project are all still correct and editable; it is the scene-kind mapping that
is wrong.

## What a read-only pass over production found

`npm run verify:live-data` drives the P10, P9 and P6 functions against the real
database. It is READ ONLY — no insert, no update, no money RPC, no vendor call — and
it prints counts, never a tenant's name or content. Figures below are from a sample of
96 profiles, 24 landing pages and 400 ledger rows.

**The biggest gap in the programme: no agent run has ever completed in production.**
185 offering rows, **0** `agent_runs` with `status = 'completed'`. The runner (P1) is
wired and gated, but it has not finished a run against the real database.

**The ledger has never carried an idempotency key.** All 400 recent
`credit_transactions` rows have `ref = NULL` and none names an `agent_run`. The
exactly-once charge path (P1) and the idempotent grant path (P9) are both implemented
and neither has ever written a ref in production. They are not wrong — they are
unused, and nothing may bill off those records until a run actually charges.

**Readiness.** 17 of 96 workspaces are ready on the data. The blockers, in order:
`budget=78`, `offerings=69`, `contact=32`, `business=1`. The dominant reason a
business cannot start is not missing setup — it is no credits (78 of 96 wallets are
exactly zero), which is the correct thing for the platform to say out loud.

**`profiles.onboarding_completed` is right about half the time.** It is true on 32
profiles; 15 really are ready and **17 are not**. So it is not worthless — it is
*unreliable*, which is worse: you cannot tell which case you are in without
recomputing. That is the whole argument for `evaluateSpine`, and all 17 disagreements
are reported rather than silently believed.

**Industry is mostly unset, and must never block.** 74 of 96 profiles have no usable
industry: 73 null plus one literal `'general'`, which is what the landing-page
generator defaults to and therefore means nothing. `industry` was blocking and is now
non-blocking, because the vocabulary already guarantees the thing that matters — an
unknown industry gets neutral wording and **never** property wording — so blocking
stopped most of the book working in order to obtain a nicer noun. `'general'` now
sits with `'generic'`, `'other'`, `'none'` and `'unknown'` as "not answered".

**Page editing works on real pages.** 24 real generated pages adopt into named
sections deterministically (median 21, up to 24) losing no section body, and an
81,747-byte real page was edited surgically — the text occurred once, one section
changed, 23 other sections came back byte-identical, and the page still parsed to the
same section list.

**No tenant is given property vocabulary by accident**, across all five industry
values that actually exist in production.

## Tooling gotchas that cost real time

- Windows PowerShell 5.1 treats a native command's **stderr** as a failure, so
  `node scripts/agent-selftest.mjs` looks like it exits 1. It exits **0**; check
  with `cmd /c "node … & echo EXITCODE=%ERRORLEVEL%"`.
- **Do not** add `"type": "module"` to `package.json` to silence Node's
  `MODULE_TYPELESS_PACKAGE_JSON` warning — it changes how every `.js` file in this
  Next app is interpreted.
- `[System.IO.Path]::GetRelativePath` does not exist here; it silently yields an
  empty list, which reads as "0 hits". Use the grep tool for counts.
- **Commit messages must go through `git commit -F <file>`.** Inline `-m "…"`
  strings containing a double quote get split by PowerShell into pathspecs and
  the commit silently fails.
- The Supabase management SQL endpoint rejects a whole migration file that has
  many comments; apply it statement-by-statement (that is how
  `20261213000000`, `20261213000100`, `20261214000000` and `20261215000000` were
  applied and verified).
- The management endpoint also mangles non-ASCII when read via
  `Get-Content` without `-Encoding UTF8`; read utf8, send utf8 bytes.

## Migrations applied to production (verified in the live DB)

- `20261213000000` / `20261213000100` — credit_holds + atomic spend/grant RPCs
- `20261214000000` — realtime publication (leads, notifications) + `last_activity_at`
- `20261215000000` — `agent_runs` (+2 indexes, 1 policy)
- `20261216000000` — `agent_runs` artefact columns (`artefact_key/url/meta` + index)
- `18_scrape_definitions` — `agent_scrape_definitions`: 1 table, **4 RLS policies**,
  3 indexes. APPLIED (12/12 statements). P8's Supabase definition store is therefore
  live; the earlier note that it was unapplied is obsolete.
- `19_lead_journey` — `lead_journey_steps`: 1 table, 3 indexes, RLS enabled.
  **APPLIED (6/6 statements), verified in the catalogue afterwards:** the table exists
  with `relrowsecurity = true`, and `lead_journey_steps_unique_step UNIQUE (lead_id,
  step_id)` is present — which is the constraint P7's exactly-once send depends on, so
  it is worth having checked rather than assumed. Earlier notes saying this was
  unapplied are obsolete.

Apply one with `node scripts/db-apply-migration.mjs <file.sql>`; `--check` reports what
is already present without applying, and `--sql "select …"` asks the catalogue a
question directly. It reads `SUPABASE_MANAGEMENT_TOKEN` from `.env.local`, applies
STATEMENT BY STATEMENT (the endpoint rejects whole files that carry many comments and
returns an empty body on 400), and prints the catalogue state before and after rather
than trusting the HTTP status.

**Still open, and it matters:** neither live proof writes `agent_runs`. A fabricated
`run_id` UPDATEs zero rows while Supabase returns `error: null`, so a naive check
reads as success. Fix that before anything bills off the artefact records.

**Tooling note (cost me a wasted attempt):** splitting a migration on `');\n'` misses
every statement in a CRLF file — the CREATE TABLE silently never runs and every
dependent `alter index`/`policy` then fails 400 for a legitimate reason. Split on
`';\\s*\n'` after stripping `--` comment lines.