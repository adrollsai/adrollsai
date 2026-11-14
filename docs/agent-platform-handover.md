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
- **P3 code-complete and gate-green, but the film is visually WRONG — do not
  commit it as done.** Untracked: `lib/agent/tools/skills/video/{beats,emit,index,timing}.ts`
  + `README.md`, `scripts/verify-video-skill.ts`, `scripts/video-skill-render-proof.ts`,
  plus edits to `lib/agent/sandbox/pipeline.ts` and `package.json`.

  Green now: `tsc` clean · `npm run verify:video-skill` **77/77** ·
  `verify:media-models` **35/35** · `agent-selftest` **78/78** · `npm run build`
  exit 0. Migration `20261216000000_agent_run_artefact.sql` applied and verified
  live (`agent_runs.artefact_key/url/meta` + index).

  A real film DID render: `D:\nobo-renders\proof\proof-toolchain-9x16-8e489094-r1\proof.mp4`
  — 1080x1920, 30 fps, 7.02 s, H.264 + AAC. Its `check.json` reports `ok:true` with
  **errorCount 0** in lint/runtime/layout/contrast(4/4)/craft/audio.

  **And yet the frames are broken.** Four frames inspected (1.2 / 3.0 / 4.8 / 6.4 s):
  1. a tall opaque **white slab covers the left third** of every frame, above the type.
     The linter even pointed at it: warning on `#brand-bug` with
     `bbox {x:0,y:0,width:0,height:0}` — a zero-size box painting a huge white area.
  2. **type is clipped off the left edge**: "…UNJAB", "…ME OR", "…OPERTY?", "…NK TO
     4BHK" — outside the 9:16 safe area, while `layout` reported totalIssueCount 0.
  3. the composited plate is **SMPTE colour bars** (the `probe/t.sh` test pattern),
     not footage. The plate DOES animate (streaks shift 4.8->6.4 s) but the **type does
     not change between 1.2 s and 3.0 s**, so the bug is in the type layer, not a
     frozen render.

  This is trap 8 in one sentence: a film can pass every automated check and still have
  a white slab over the words. Always pull frames from the MP4 and look.

  Still to do: fix the plate so it cannot occlude; make the zero-size `#brand-bug`
  bbox a hard failure rather than a warning; keep every text block inside the safe area
  and assert it; re-render one film with real (non-colour-bar) plates and type that
  visibly changes between beats.
- **P5 (images) and P8 (scraping) are running in parallel** — both independent of the
  video toolchain. P5 must delete every background+HTML-overlay path (banned by
  section 0) and prove 10 live images on `D:\nobo-images\`. P8 must refuse login
  walls, honour robots.txt + per-host rate limits, guard SSRF, and cache to R2.
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
