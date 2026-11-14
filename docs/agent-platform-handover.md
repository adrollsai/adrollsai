# Agent platform — handover

State of the P1–P10 programme. Read this before touching anything; every claim
here was verified by a gate or a live call, not inferred.

## Committed and green

| Commit | What |
|---|---|
| `717302d1` | **P1** durable sandbox runner wired to E2B + Supabase + credits + R2 |
| `1c936ba2` | **P2** every media-model id from the registry, retry-then-fallback |
| `d526f4c6` | P2 follow-up: 3.8 TTS model verified against kie live |
| `fb627419` | Session baseline (payments, agent UI, STT, CRM live updates, pre-flight, call receipts) |

Branches `p1-runner-integration`, `p2-model-router`, `p2b-tts-verified` exist so
each package reverts alone. Nothing has been pushed.

Gate commands:

```bash
node scripts/agent-selftest.mjs          # 78 assertions  (P1)
npm run verify:media-models              # 35 assertions  (P2)
npx tsc --noEmit                         # filter TS6053 while a dev server runs
NODE_OPTIONS=--max-old-space-size=8192 npm run build
```

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
- **P3 in flight, UNCOMMITTED and RED at handover.** Do not commit it as-is.
  Present and untracked: `lib/agent/tools/skills/video/{beats,emit,index,timing}.ts`,
  plus edits to `lib/agent/sandbox/pipeline.ts`. `D:\nobo-renders` now exists
  (the render attempt started).

  Migration `20261216000000_agent_run_artefact.sql` **was applied and verified**
  (agent_runs gains `artefact_key` / `artefact_url` / `artefact_meta` +
  `agent_runs_artefact_idx`) — that part is safe and already live.

  Outstanding, in order of cheapness:
  1. **5 import errors**, all the same mistake — `lib/agent/tools/skills/video/index.ts`
     is four levels below `lib/agent/`, so `'../../media-models'` lands on
     `lib/agent/tools/`. Needs `'../../../media-models'` / `'../../../sandbox/{pipeline,e2b,log,runner}'`,
     or better, the `@/lib/agent/...` alias the sibling skills use (index.ts:35,50,51,52,53,54 and 1060).
  2. `index.ts(122,8)` TS2872 always-truthy expression.
  3. `index.ts(795,60)` TS2322 — the `hyperframes check --json` result typed
     `| null` being coerced into a non-null shape. Per trap 8 a missing check
     must FAIL the step, not be coerced into a pass.
  4. `index.ts(1193,32)` TS2339 `Property 'total' does not exist on type 'never'`.
  5. No `scripts/verify-video-skill.ts` and no `verify:video-skill` npm script.
  6. No render evidence yet (no frames pulled from an MP4).

  A previous feedback message with these same diagnostics was sent to the P3
  worker; it had not yet applied them when the session ended.
- **P4–P10 not started.**
- **P4–P10 not started.**

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
