# The `reverse` skill — an existing MP4 → an editable HyperFrames film

Point it at a reference video. It measures the film, writes down what it measured,
rebuilds the film as a `beats.json` the **`video` skill itself validates**, and then
holds the result against the original frame by frame.

```
reference.mp4
   │
   ├── analyse.ts ──▶ measurement ──────────────────────────┐
   │      ffprobe: duration, size, fps, streams             │
   │      scene-detect: every cut                           │
   │      silencedetect: the voice, up a noise-floor ladder │
   │      sampled frames: palette, luma, where type sits    │
   │                                                        ▼
   ├── spec.ts ─────▶ SPEC.md        ("what was measured, and what a human must decide")
   │
   ├── rebuild.ts ──▶ beats.json  ──▶ video/beats.parseBeats   ← the video skill is the judge
   │                  timing.json ──▶ video/timing.measureVoiceover
   │                  project/    ──▶ video/emit.emitProject   ← same emitter, same traps
   │
   └── compare.ts ──▶ runtime drift, beat count, frame-by-frame contact sheet
```

Nothing here renders. Nothing here calls a vendor. `npm run verify:reverse-skill`
drives the whole pipeline over faked process seams and proves the contract; the live
harness (`scripts/reverse-live-proof.ts`) runs ffmpeg for real.

## The three rules this skill is built around

**1. It measures; it does not guess.**
There is no OCR and no speech-to-text in this pipeline, so the rebuild cannot know the
reference's words. Every line of on-screen copy is the marked blank `WORD WORD`, the
voice line is `UNKNOWN WORDS`, and the brand card is `BRAND UNKNOWN` /
`TAGLINE UNKNOWN` / `ADDRESS UNKNOWN`. A placeholder that looks like copy is worse
than one that does not: someone will ship it.

The words are a question for a human, and `openQuestions()` lists them. Supply them
through `rebuild.lines['sh03'] = ['SITE VISIT TODAY']` and they are used verbatim.

**2. The SPEC cannot print a figure the measurement did not produce.**
`auditSpec()` extracts every number from the finished SPEC.md and checks each one
against every number in the analysis object. A figure with no measurement behind it
is a bug in the spec generator, and it is reported (`audit.invented`) rather than
printed and trusted.

**3. A near miss is reported, never rounded away.**
An onset more than the tolerance from every cut is real voice, so it is listed in
`alignment.unaligned` with its distance and the shot it was nearest to. A cut 33 ms
after the previous one is a splice artefact: it is dropped **and reported**. A rebuild
that runs 6 s long is a `DRIFTS`, not a match — `compareRuntime` prints the drift
rather than deciding it is close enough.

## Why the plates are the reference's own shots

`rebuild.ts` sets every plate to `source: 'asset'` pointing at
`assets/src/sh01.mp4` … A reverse buys **no** media model: no motion clip is
generated and no voice is synthesised. The picture is the reference's own footage and
the clock is the reference's own measured voice, so the only cost of a reverse is the
sandbox render (`estimateReverseCredits()` → `media: 0`).

The live harness slices the reference into one mp4 per shot and into per-beat wavs
under `assets/voice/`, which is what makes the rebuild's clock actually play.

## Traps inherited from the video skill, and how they are handled

| Trap | What `rebuild.ts` / `emitProject` does |
| --- | --- |
| A scene on screen at `t = 0` never reveals its `.clip` overlays | `s0` is a plate-only 0.5 s lead-in, always; the first shot's own scene starts at 0.5 s |
| One `.mp4` used by two scenes with different `data-media-start` dies ~70 % into the render | every reused plate is **copied** per scene (`sh01__s0.mp4`), so each `<video>` owns its file |
| End-card blocks must be `position: absolute` | the end card is emitted by `emitProject`, unchanged |
| Type must be readable: `0.5 s + 0.3 s per word`, ≤ 5 words a line at 9:16 | a line is capped by both the measured box's word estimate and the measured hold, and a beat too short to hold one word keeps its voice but gets no line |
| Loudness must be normalised in exactly one place | the project carries the video skill's own `master.sh` (`-16 LUFS`, `TP -1.5`, linear gain) |

## What it refuses

A reference whose voice cannot be measured cannot become a film. The `video` skill's
`parseBeats` refuses an empty `beats` array and its emitter writes a voice track per
beat, so there is nothing to rebuild against. `rebuildFromAnalysis` throws
`ReverseRebuildError` naming the measurement's own reason ("no noise floor between
-35 dB and -15 dB separated 2 distinct speech blocks…") instead of emitting a project
that would die at render time with a message nobody can act on.

The same refusal covers a film with no audio stream at all.

## Files

| File | What it is |
| --- | --- |
| `analyse.ts` | the measurement, and every parser it needs — pure except `analyseVideo`, which takes injected process seams |
| `spec.ts` | SPEC.md in the house style, plus `auditSpec` |
| `rebuild.ts` | measurement → `beats.json` → `timing` → emitted project |
| `compare.ts` | runtime drift, beat count, frame difference, contact-sheet ffmpeg graphs |
| `index.ts` | the entry point: `reverseSkill()`, artefact keys, credit estimate, open questions |

`npm run verify:reverse-skill` — 85 assertions, no network, no binary, no render.
