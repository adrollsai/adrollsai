# `video` skill — beats.json → measured timing → HyperFrames → R2

One call renders a film and publishes it to R2, recording the key on
`agent_runs`. Nothing in here is a second runner: it drives
`lib/agent/sandbox/pipeline.ts` (`runVideoPipeline`), which owns the durable
three-step run (`voiceover → clips → render`), the checkpointing, the per-step
charge, the idle pause and the soft cap.

```
beats.json ──parseBeats──▶ Beats
                             │
voiceover step ──TTS──▶ wav ──ffmpeg silencedetect + ffprobe──▶ onsets (measured)
                             │
                    measureVoiceover(onsets) ──▶ timing.json   (pure)
                             │
                    emitProject(beats, timing) ──▶ project     (pure)
                             │
clips step   ── plates + grading.sh (ffmpeg grade, per-scene copies) ──▶ project.json
render step  ── check --json (must be 0 errors) → render → R2 ──▶ final.mp4 + agent_runs
```

| file | I/O | what it owns |
|---|---|---|
| `beats.ts` | none | the input contract, `parseBeats`, seeded ids, the word ceiling |
| `timing.ts` | none | the measured clock, `measureVoiceover`, `timing.json` |
| `emit.ts` | none | the HyperFrames project as strings: layouts, scenes, grade, copies |
| `index.ts` | all of it | plan → credits → `runVideoPipeline` → R2 → `agent_runs` |

## The call

```ts
const plan = planVideoSkill({ beats });        // pure, priced from the registry
// ...show plan.briefing, plan.credits, plan.artefactKey, then:
const result = await runVideoSkill({
  runId, userId, input: { beats, aspect: '9:16', targetSeconds: 45 },
});
// result.artefact.key === 'video/<jobId>-9x16-<seed>/final.mp4'
// result.recorded === { recorded: true, reason: null }
```

## beats.json

One file drives **both** aspects (`9:16` and `16:9`); the aspect is the only
geometry input. Everything is derived from the plan plus the *measured* voice.

```jsonc
{
  "version": 1,                       // only 1 is accepted
  "jobId": "meridian-tricity",        // SEEDED: lowercase [a-z0-9._-], 2-64 chars.
                                      // Names the sandbox dir and the R2 prefix.
  "aspect": "9:16",                   // "9:16" | "16:9"
  "fps": 30,                          // 24 | 25 | 30 (the only rates the renderer emits)
  "targetSeconds": 30,                // >= 30. A shorter film is refused.
  "onScreenLanguage": "en",           // what the viewer READS. "en" enforces Latin-only copy.
  "logoOnScreen": true,               // brand bug; needs endCard.logo to actually render

  "voice": {                          // what the voice SPEAKS
    "language": "hinglish",
    "speaker": "Charon",              // kie voice name (google/gemini-3-8-flash-tts)
    "scene": "Confident Indian narrator, warm authority, no shouting.",
    "sampleContext": "optional"
  },

  "endCard": {
    "name": "Meridian Group",
    "tagline": "Spaces That Keep Their Promise",
    "numbers": ["9876500123", "9876500456"],   // exactly two
    "address": ["4th Floor, Sector 34", "Chandigarh"],  // one or two lines
    "pledge": "YOUR NEED, OUR PRIORITY",        // optional
    "logo": "assets/brand/logo.png"             // optional; ALSO its R2 key
  },

  "plates": [                          // where the pixels come from
    { "id": "hook-a", "source": "asset", "key": "assets/src/hook-a.mp4" },
    { "id": "types-a", "source": "generate", "prompt": "slow push in on towers", "seconds": 5 },
    { "id": "places-a", "source": "asset", "key": "r2/plates/places-a.mp4", "mediaStart": 1.2 }
  ],

  "beats": [                           // one entry per thing said or shown
    {
      "id": "p01",                     // seeded: [a-z][a-z0-9_-]{0,23}; names the wav
      "vo": "Tricity mein ghar dhoond rahe ho?",   // spoken; "" is allowed
      "lines": ["HOME OR", "PROPERTY?"],           // on screen, one reveal each, <= 3
      "label": "TRICITY PUNJAB",                    // optional kicker, <= 5 words
      "plate": "hook-a"                             // optional; else the scene's plate
    }
  ],

  "scenes": [                          // the film, in order. Must end with "endcard".
    { "id": "s1", "kind": "hook",  "beats": ["p01"], "plate": "hook-a" },
    { "id": "s2", "kind": "beat",  "beats": ["p02", "p03"], "plate": "types-a" },
    { "id": "s3", "kind": "list",  "beats": ["p04", "p05", "p06"], "plate": "places-a" },
    { "id": "s4", "kind": "info",  "beats": ["p07"], "plate": "card-a" },
    { "id": "s5", "kind": "cta",   "beats": ["p08"], "plate": "cta-a" },
    { "id": "s6", "kind": "numbers", "beats": [], "dur": 2.4, "plate": "numbers-a" },
    { "id": "s7", "kind": "endcard", "beats": ["p09"], "plate": "end-a" }
  ]
}
```

`kind` decides how the beats are drawn: `hook` (big opening lines), `beat` (one
line replaces the last), `list` (rows accumulate), `info` (flat card, rows
accumulate), `cta` (lines with rules), `numbers` (plaque column), `endcard` (one
held card). Every kind is industry-neutral.

A scene with `beats: []` is silent and must state `dur` (0.5–12 s) — with no voice
there is nothing to measure.

### Rules enforced at parse time (before any spend)

* `targetSeconds >= 30`; `fps ∈ {24,25,30}`; `aspect ∈ {9:16,16:9}`.
* `<= 5` words per on-screen line at 9:16, `<= 9` at 16:9; `<= 3` lines per beat;
  `<= 5` words per label. The readability rule is `0.5 s + 0.3 s per word`, and a
  plan whose voice cannot carry its own type is refused by the emitter rather than
  shipped.
* `onScreenLanguage: "en"` rejects non-Latin copy.
* Every beat belongs to exactly one scene; `s0` is reserved (the 0.5 s lead-in);
  the last scene must be `endcard`; every scene needs a plate.
* `generate` plates are 1–6 s (the video model is billed per second).

## timing.json

Derived, never typed. Per-scene detail is flattened onto the root (`s1`, `s2`, …)
exactly as the reference film's measured timing file had it.

```jsonc
{
  "total": 46.48,
  "vo": [{ "id": "p01", "start": 0.62, "dur": 2.66 }],
  "sceneList": { "s0": { "start": 0, "dur": 0.5 }, "s1": { "start": 0.5, "dur": 5.51 } },
  "s1": { "dur": 5.51, "kind": "hook", "beats": [0.12, 1.31], "out": 5.23 },
  "vobug": { "start": 0.5, "end": 40.52 },
  "measured": [{ "id": "p01", "start": 0, "dur": 2.66, "lead": 0.41 }],
  "drift": 0
}
```

* `s0` is always exactly 0.5 s and plate-only (a scene on screen at t = 0 never
  reveals its non-media `.clip` overlays).
* Scenes tile the film: `scene[i].start + dur === scene[i+1].start`, and
  `total === last.end`.
* The voice is laid out with a 0.2 s gap; scenes are cut around it. A line may
  lead its own picture cut by up to 0.15 s, no more.
* Under the length floor the **end card holds longer**; beats are never stretched.

## What the emitted project contains

`index.html`, `compositions/s0-lead.html`, one composition per scene,
`timing.json`, `beats.json`, `grading.sh`, `package.json` (CLI pinned to
`hyperframes@0.9.43`), `hyperframes.json`, `meta.json`.

Non-negotiables the emitter encodes (each one cost the reference film a failed
render or a QA pass):

1. `.clip { position: absolute; inset: 0 }` in every composition — without a box a
   full-frame scrim collapses to zero height.
2. A plate played by two scenes is **copied** per scene (`hook-a__s3.mp4`), never
   shared with a different `data-media-start`.
3. Every text block is `position: absolute`.
4. One warm grade, baked with ffmpeg in `grading.sh` (`eq`, `colorbalance`,
   `unsharp`, `vignette`, `noise`) — never a CSS filter.
5. Type stays inside the safe band (168–1330 px at 9:16), and the end card shrinks
   on a fixed scale ladder before it would run past the floor.
6. Only font families the CLI can auto-resolve (`Archivo Black`, `Inter`) are
   named; a stack falling back to `Impact` fails `check`.
7. No `Date.now()`, no `Math.random()`: the same beats + the same onsets emit
   byte-identical files, so the artefact key means something.

## Money

`planVideoSkill` prices the run from `lib/agent/media-models.ts` only:
`estimateCredits('voice', lines)`, `videoCredits(seconds)` for generated plates,
and the pipeline's own `RENDER_CREDITS`. The reservation happens inside
`runVideoPipeline`; a step that is skipped because its artefact already exists is
not charged.

## The `agent_runs` artefact columns

`supabase/migrations/20261216000000_agent_run_artefact.sql` adds
`artefact_key`, `artefact_url`, `artefact_meta`. `recordRunArtefact()` writes them
and, if the migration has not been applied, returns
`{ recorded: false, reason }` instead of failing a render that already succeeded.

## Verifying

* `npm run verify:video-skill` — 73 checks, no network, no render.
* `node scripts/video-skill-render-proof.ts` (bundled like the other `scripts/`
  entries) — synthesises voice + plates, measures them with the real ffmpeg
  commands, emits, runs `grading.sh`, then `check --json` and a ≤8 s 9:16 render
  under `D:\nobo-renders`, and pulls frames out of the MP4 to look at.
