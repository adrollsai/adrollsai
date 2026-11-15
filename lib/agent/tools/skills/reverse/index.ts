/**
 * The `reverse` skill: an existing MP4 -> a measurement -> a SPEC.md -> a `beats.json`
 * the `video` skill validates and emits -> a render -> a frame-by-frame comparison.
 *
 * WHAT THIS FILE IS, AND IS NOT
 *   - It is the ENTRY POINT of the skill and the only place that composes the four
 *     modules: `analyse.ts` (measure), `spec.ts` (say what was measured),
 *     `rebuild.ts` (hand the measurement to the `video` skill), `compare.ts` (hold
 *     the result against the reference).
 *   - It is NOT a second video pipeline. It never renders a project itself and it
 *     never emits HTML: `rebuild.ts` calls `emitProject` from
 *     `../video/emit.ts`, and the render is the project's own pinned HyperFrames
 *     CLI, exactly as `../video/index.ts` runs it.
 *   - It spends NOTHING on a vendor. There is no voice call and no motion call in
 *     this skill: the plates are the reference's own shots and the clock is the
 *     reference's own measured voice. The only cost of a reverse is the render.
 *
 * WHY IT IS HONEST BY CONSTRUCTION
 *
 *   `spec.ts` cannot print a figure that `analyse.ts` did not measure (`auditSpec`),
 *   `rebuild.ts` cannot produce a beats file the `video` skill would reject
 *   (`parseBeats`), and `compare.ts` cannot call a 6 s drift a match. Everything a
 *   human must decide — the words, the brand, the tempo, the typeface — is written
 *   down as `UNKNOWN — needs a human` instead of guessed.
 *
 * Nothing here runs at import time: no process, no env, no network.
 */

import { roundTo } from '../video/beats';
import type { Timing } from '../video/timing';
import { timingJsonText } from '../video/timing';
import type { EmittedProject, EmittedFile } from '../video/emit';
import { RENDER_CREDITS } from '../../../sandbox/pipeline';
import {
  analyseVideo,
  type AnalysisTools,
  type AnalyseOptions,
  type ReverseAnalysis,
} from './analyse';
import { auditSpec, emitSpec, UNKNOWN, type SpecAudit, type SpecOptions } from './spec';
import {
  rebuildFromAnalysis,
  beatsJsonText,
  jobIdFor,
  type RebuildOverrides,
  type RebuildPlan,
} from './rebuild';
import {
  compareBeats,
  compareRuntime,
  describeComparison,
  type BeatComparison,
  type RuntimeComparison,
} from './compare';

/** The name this skill is addressed by. */
export const SKILL_NAME = 'reverse';

/** R2 / working-set prefix for everything a reverse produces. */
export const ARTEFACT_ROOT = 'reverse';

// ────────────────────────────────────────────────────────────────────────────
// Input and output
// ────────────────────────────────────────────────────────────────────────────

export interface ReverseSkillInput {
  /** The reference film: a path the injected `AnalysisTools` can read. */
  file: string;
  /** Heading for the SPEC. Defaults to the file name without its extension. */
  title?: string;
  /** Analysis knobs (scene threshold, alignment tolerance, sample count). */
  analyse?: AnalyseOptions;
  /** Anything a human wants to supply: the brand card, on-screen copy, the voice. */
  rebuild?: RebuildOverrides;
  /** Extra BANNED lines for the SPEC (craft notes, never measurements). */
  extraBans?: readonly string[];
  /** A human-supplied goal line for the SPEC. */
  goal?: string;
}

export interface ReverseArtefactKeys {
  spec: string;
  beats: string;
  timing: string;
  analysis: string;
  comparison: string;
  contactSheet: string;
  film: string;
}

/**
 * Where a reverse's artefacts belong.
 *
 * Seeded exactly like the video skill's: the same reference with the same options
 * always names the same keys, so a re-run overwrites rather than littering.
 */
export function artefactKeysFor(analysis: ReverseAnalysis, jobId?: string): ReverseArtefactKeys {
  const id = jobIdFor(analysis, jobId);
  const root = `${ARTEFACT_ROOT}/${id}`;
  return {
    spec: `${root}/SPEC.md`,
    beats: `${root}/beats.json`,
    timing: `${root}/timing.json`,
    analysis: `${root}/analysis.json`,
    comparison: `${root}/comparison.json`,
    contactSheet: `${root}/contact-sheet.png`,
    film: `${root}/final.mp4`,
  };
}

export interface ReverseResult {
  analysis: ReverseAnalysis;
  /** The SPEC.md, in the house style. */
  spec: string;
  /** The proof that the SPEC holds no invented figure. */
  audit: SpecAudit;
  rebuild: RebuildPlan;
  /** `beats.json`, exactly as written. */
  beatsJson: string;
  /** `timing.json`, exactly as written. */
  timingJson: string;
  project: EmittedProject;
  keys: ReverseArtefactKeys;
  /** The runtime verdict for this rebuild (the drift, measured, not asserted). */
  runtime: RuntimeComparison;
  /** Measured onsets vs the rebuild's spoken beats. */
  beats: BeatComparison;
  /** One line for the log and for the human who asked for the reverse. */
  briefing: string;
  notes: string[];
}

/**
 * Measure a reference film and produce everything that does not need a render: the
 * analysis, the SPEC, the beats file the `video` skill accepts, the measured clock
 * and the emitted project.
 *
 * The render and the frame comparison need a filesystem and a CLI, so they belong to
 * the caller (`scripts/reverse-live-proof.ts` is the reference harness) — this
 * function stays a pure composition of the four modules over injected tools.
 */
export async function reverseSkill(
  input: ReverseSkillInput,
  tools: AnalysisTools,
): Promise<ReverseResult> {
  if (!input?.file) throw new Error('[reverse-skill] needs { file } — the reference mp4 to analyse');

  const analysis = await analyseVideo(input.file, tools, input.analyse ?? {});
  const specOptions: SpecOptions = {
    ...(input.title ? { title: input.title } : {}),
    ...(input.goal ? { goal: input.goal } : {}),
    ...(input.extraBans ? { extraBans: input.extraBans } : {}),
  };
  const spec = emitSpec(analysis, specOptions);
  const audit = auditSpec(spec, analysis);
  const rebuild = rebuildFromAnalysis(analysis, input.rebuild ?? {});

  const runtime = compareRuntime(analysis.facts.durationSeconds, rebuild.timing.total);
  const beats = compareBeats(analysis.vo.spans.length, rebuild.beats.beats.filter((beat) => beat.vo.length > 0).length);

  const notes = [...analysis.notes, ...rebuild.notes];
  if (!audit.ok) {
    notes.push(
      `the SPEC carries ${audit.invented.length} figure(s) the analysis cannot account for ` +
        `(${audit.invented.join(', ')}) — the spec generator has a bug, and the SPEC must not be trusted until it is fixed`,
    );
  }

  return {
    analysis,
    spec,
    audit,
    rebuild,
    beatsJson: beatsJsonText(rebuild),
    timingJson: timingJsonText(rebuild.timing),
    project: rebuild.project,
    keys: artefactKeysFor(analysis, input.rebuild?.jobId),
    runtime,
    beats,
    briefing: describeReverse(analysis, rebuild.timing, runtime, beats),
    notes,
  };
}

/** One line for the log: what was measured, and what the rebuild did with it. */
export function describeReverse(
  analysis: ReverseAnalysis,
  timing: Timing,
  runtime: RuntimeComparison,
  beats: BeatComparison,
): string {
  const { facts, film, vo } = analysis;
  return (
    `${facts.basename} · ${facts.aspect} ${facts.fps}fps ${facts.durationSeconds}s · ${film.shotCount} shots · ` +
    `${film.textBoxCount} type boxes · ${vo.spans.length} onsets (${vo.present ? `${vo.thresholdDb}dB` : 'ABSENT'}) ` +
    `→ rebuild ${timing.total}s · ${beats.rebuildBeats} beats · ${runtime.withinTolerance ? 'runtime matches' : `drift ${runtime.driftSeconds}s`}`
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Money
// ────────────────────────────────────────────────────────────────────────────

export interface ReverseCreditEstimate {
  /** No vendor is called: a reverse buys no voice and no motion. */
  media: number;
  /** The one real cost: sandbox compute for the HyperFrames render. */
  render: number;
  total: number;
  detail: string;
}

/**
 * What a reverse costs.
 *
 * Zero on the media registry, on purpose: the plates are the reference's own shots
 * and the clock is its own measured voice, so nothing is generated. The render is
 * charged exactly as the video skill charges it (`RENDER_CREDITS`).
 */
export function estimateReverseCredits(renderCredits = RENDER_CREDITS): ReverseCreditEstimate {
  return {
    media: 0,
    render: renderCredits,
    total: renderCredits,
    detail: `no media model is called; ${renderCredits} credits is the render step only`,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Files
// ────────────────────────────────────────────────────────────────────────────

/**
 * Everything to write for one reverse, in one list.
 *
 * The SPEC and the two JSON files come first because they are the reviewable part;
 * the emitted HyperFrames project follows exactly as `emitProject` produced it. A
 * caller writes these and then runs the project's own `grading.sh`, `check` and
 * `render`.
 */
export function reverseFiles(result: ReverseResult): EmittedFile[] {
  return [
    { path: 'SPEC.md', content: result.spec },
    { path: 'beats.json', content: result.beatsJson },
    { path: 'timing.json', content: result.timingJson },
    { path: 'analysis.json', content: `${JSON.stringify(result.analysis, null, 2)}\n` },
    ...result.project.files.filter(
      (file) => file.path !== 'beats.json' && file.path !== 'timing.json',
    ),
  ];
}

/** The unknowns a human still has to answer before the rebuild is a film. */
export function openQuestions(analysis: ReverseAnalysis): string[] {
  const questions: string[] = [
    `on-screen copy for ${analysis.film.typeShotCount} shot(s) with type — the words are ${UNKNOWN.replace('UNKNOWN — ', '')}`,
    `brand name, tagline, two phone numbers and the address for the end card — ${UNKNOWN.replace('UNKNOWN — ', '')}`,
    'the typeface, the accent colour and the brand colour',
    'the musical tempo, if the reference has a bed (a BPM cannot be read from a container)',
  ];
  if (!analysis.vo.present) {
    questions.push('the voice itself: no onset could be measured, so the rebuild has no voice track');
  } else if (analysis.alignment.unaligned.length) {
    questions.push(
      `what happens to onsets ${analysis.alignment.unaligned.map((onset) => onset.index).join(', ')}: they sit ` +
        `further than ${roundTo(analysis.alignment.toleranceSeconds, 2)}s from every cut`,
    );
  }
  return questions;
}
