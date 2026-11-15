/**
 * rebuild.ts — the measurement, turned into a `beats.json` the EXISTING video skill
 * validates and emits. No second emitter lives here.
 *
 *     ReverseAnalysis ──beatsFromAnalysis──▶ raw beats.json
 *                                              │
 *                                    parseBeats (imported, NOT reimplemented)
 *                                              │
 *                    measureVoiceover(onsets, scenePlanFor(beats), measured options)
 *                                              │
 *                                   emitProject (imported, NOT reimplemented)
 *
 * WHAT IS MEASURED, AND WHAT IS A MARKED BLANK
 *
 *   plates      one per shot, `asset`, `assets/src/sh01.mp4` … — the reference's own
 *               picture, so the rebuild is editable rather than regenerated
 *   timing      from the reference's own measured voice onsets, laid out by the
 *               video skill's own clock, with `gap` / `pad` / `openOffset`
 *               CALIBRATED from the reference's measured pauses
 *   runtime     `targetSeconds` = the reference's runtime, so the skill's own floor
 *               rule ("the end card holds longer, beats are never stretched") closes
 *               the difference instead of this file stretching anything
 *   copy        a MARKED BLANK. `WORD WORD` where the reference has type — in the
 *               measured box's estimated word count, capped by how long the measured
 *               voice actually holds that line on screen. There is no OCR and no
 *               transcript in this pipeline, and a placeholder that looks like copy
 *               is worse than one that does not.
 *   brand       `BRAND UNKNOWN` / `TAGLINE UNKNOWN` / `ADDRESS UNKNOWN` / placeholder
 *               digits. `parseBeats` requires an end card, so the blanks are
 *               required — and they are named as blanks.
 *
 * ONE MODE, AND WHY THERE IS ONLY ONE
 *
 * A reverse could in principle tile the shots as SILENT scenes at their measured
 * durations, which would pin the runtime exactly. That is not expressible in the
 * video skill's contract: a beats file must contain at least one beat, every beat
 * must belong to a scene, and a scene with a beat is timed by its voice. So the
 * rebuild is voice-driven, like every other film the skill makes, and the runtime is
 * made to match by two honest means: the timing knobs are calibrated from the
 * reference (`calibrateTiming`), and if the layout still overruns the reference's
 * runtime the inter-line gap is tightened until it does not (`fitTimingToRuntime`),
 * after which the skill's own floor rule holds the end card for the remainder. Both
 * adjustments are recorded, and `compare.ts` measures what they achieved.
 *
 * PURE: no I/O, no clock, no randomness. The same analysis always produces the same
 * beats.json, the same timing and the same project.
 */

import {
  LEAD_IN_SECONDS,
  MAX_LINE_WORDS,
  MIN_TARGET_SECONDS,
  SUPPORTED_FPS,
  minHoldSeconds,
  parseBeats,
  roundTo,
  type Beats,
  type SceneKind,
} from '../video/beats';
import { measureVoiceover, type Timing, type VoOnset } from '../video/timing';
import { emitProject, EmitError, type EmittedProject } from '../video/emit';
import { scenePlanFor } from '../video/index';
import type { ReverseAnalysis, ShotFacts, SpeechSpan } from './analyse';

/**
 * Thrown when a reference cannot become a film the `video` skill will accept.
 *
 * The only way to reach it today is a reference with no measurable voice line: the
 * video skill's emitter writes a voice track and `parseBeats` refuses an empty
 * `beats` array, so there is nothing to rebuild against. That is a question for a
 * human, and it is refused with the question rather than shipped as a silent film.
 */
export class ReverseRebuildError extends Error {
  /** Everything that was measured and decided before the refusal. */
  readonly notes: string[];
  constructor(message: string, notes: string[] = []) {
    super(`rebuild: ${message}`);
    this.name = 'ReverseRebuildError';
    this.notes = notes;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Which shot a measured onset belongs to
// ────────────────────────────────────────────────────────────────────────────

export interface ShotOnset {
  span: SpeechSpan;
  shot: ShotFacts;
  /** True when `analyse.ts` aligned this onset to the shot's own cut. */
  aligned: boolean;
  /** Signed seconds from that cut. */
  deltaSeconds: number;
}

/**
 * Attach every measured onset to a shot — INCLUDING the ones that did not align.
 *
 * An unaligned onset is voice that was filmed; dropping it would make the rebuild
 * shorter and quieter than the reference for no reason a reviewer could see. So it is
 * placed in the shot whose window contains it (falling back to the nearest cut) and
 * stays flagged `aligned: false`, which the notes and the spec both report.
 */
export function onsetsByShot(analysis: ReverseAnalysis): ShotOnset[] {
  if (analysis.shots.length === 0) return [];
  const out: ShotOnset[] = [];
  const alignedByIndex = new Map(analysis.alignment.aligned.map((entry) => [entry.index, entry]));

  for (const span of analysis.vo.spans) {
    const aligned = alignedByIndex.get(span.index);
    if (aligned) {
      const shot = analysis.shots.find((entry) => entry.index === aligned.shotIndex);
      if (shot) {
        out.push({ span, shot, aligned: true, deltaSeconds: aligned.deltaSeconds });
        continue;
      }
    }

    // Not aligned: the shot whose window contains the onset, else the nearest cut.
    const containing = analysis.shots.find((shot) => span.start >= shot.start - 1e-9 && span.start < shot.end);
    const nearest =
      containing ??
      analysis.shots.reduce(
        (best, shot) => (Math.abs(span.start - shot.start) < Math.abs(span.start - best.start) ? shot : best),
        analysis.shots[0],
      );
    out.push({ span, shot: nearest, aligned: false, deltaSeconds: roundTo(span.start - nearest.start, 3) });
  }
  return out.sort((a, b) => a.span.start - b.span.start);
}

// ────────────────────────────────────────────────────────────────────────────
// The marked blanks
// ────────────────────────────────────────────────────────────────────────────

/** The word the rebuild puts where the reference has type but no readable copy. */
export const PLACEHOLDER_WORD = 'WORD';
/** The voice line: a blank, not a transcript. */
export const PLACEHOLDER_VO = 'UNKNOWN WORDS';
export const PLACEHOLDER_BRAND = 'BRAND UNKNOWN';
export const PLACEHOLDER_TAGLINE = 'TAGLINE UNKNOWN';
export const PLACEHOLDER_ADDRESS = 'ADDRESS UNKNOWN';
/** `parseBeats` demands two number-shaped strings. These are not phone numbers. */
export const PLACEHOLDER_NUMBERS: readonly [string, string] = ['0000000000', '0000000001'];

/**
 * How many words a measured type box plausibly holds.
 *
 * Pure geometry, and used only to make the PLACEHOLDER the right length so the
 * rebuilt frame's type block covers roughly the area the reference's did. It is not a
 * transcription, and nothing prints it as one.
 */
export function estimatedWords(widthPx: number, heightPx: number, aspect: Beats['aspect']): number {
  const ratio = widthPx / Math.max(1, heightPx);
  return Math.max(1, Math.min(MAX_LINE_WORDS[aspect], Math.round(1 + ratio / 2.2)));
}

/**
 * The most words a line can carry and STILL BE READABLE inside `holdSeconds`.
 *
 * `minHoldSeconds` is the video skill's own rule (`0.5 s + 0.3 s per word`) and the
 * emitter REFUSES a line that breaks it, so the placeholder is sized to what the
 * measured voice can actually carry. A measured onset too short for even one word is
 * reported by `rebuildFromAnalysis`, not silently given an unreadable beat.
 */
export function wordsThatFit(holdSeconds: number): number {
  // 0.5 + 0.3w <= hold  =>  w <= (hold - 0.5) / 0.3
  return Math.max(0, Math.floor((holdSeconds - 0.5) / 0.3 + 1e-9));
}

function placeholderLine(words: number): string {
  return Array.from({ length: Math.max(1, words) }, () => PLACEHOLDER_WORD).join(' ');
}

// ────────────────────────────────────────────────────────────────────────────
// Timing options, calibrated from the reference rather than from the house default
// ────────────────────────────────────────────────────────────────────────────

export interface CalibratedTiming {
  /** Silence between two spoken lines, as measured on the reference. */
  gap: number;
  /** Room after a scene's last line before the next cut, as measured. */
  pad: number;
  /** How long after the lead-in the first line starts, as measured. */
  openOffset: number;
  resumeGap: number;
  minTotal: number;
  /** The figures the calibration was derived from, for the notes and the report. */
  measured: { onsets: number; medianGap: number; medianPad: number; headSeconds: number };
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? roundTo((sorted[mid - 1] + sorted[mid]) / 2, 3) : sorted[mid];
}

/**
 * Read the video skill's own timing knobs off the reference.
 *
 * The house defaults (`gap` 0.2 s, `pad` 0.28 s, `openOffset` 0.12 s) are a house
 * rhythm. A reference film has its OWN: the silences between its lines, the room it
 * leaves after a shot's last line, and how long it waits before the first line. All
 * three are measurable, so all three are measured — and if no voice could be measured
 * at all, the house defaults stay and `measured.onsets` is 0, which says so.
 */
export function calibrateTiming(analysis: ReverseAnalysis): CalibratedTiming {
  const spans = analysis.vo.spans;
  const minTotal = Math.max(MIN_TARGET_SECONDS, roundTo(analysis.facts.durationSeconds, 2));

  if (!spans.length) {
    return {
      gap: 0.2,
      pad: 0.28,
      openOffset: 0.12,
      resumeGap: 0.34,
      minTotal,
      measured: { onsets: 0, medianGap: 0, medianPad: 0, headSeconds: 0 },
    };
  }

  const gaps: number[] = [];
  for (let i = 1; i < spans.length; i++) {
    const gap = spans[i].start - spans[i - 1].end;
    if (gap >= 0) gaps.push(roundTo(gap, 3));
  }

  // Room after the last line of a shot, measured to that shot's own end.
  const pads: number[] = [];
  for (const shot of analysis.shots) {
    const inShot = spans.filter((span) => span.start >= shot.start - 1e-9 && span.start < shot.end);
    if (!inShot.length) continue;
    pads.push(roundTo(Math.max(0, shot.end - inShot[inShot.length - 1].end), 3));
  }

  const head = roundTo(Math.max(0, spans[0].start - LEAD_IN_SECONDS), 3);
  const clamp = (value: number, low: number, high: number): number => roundTo(Math.min(high, Math.max(low, value)), 3);

  // Clamped, because one odd measurement must not be able to produce a film with no
  // room between its lines, or a hold after every cut long enough to stall it.
  const gap = clamp(gaps.length ? median(gaps) : 0.2, 0.02, 2);
  const pad = clamp(pads.length ? median(pads) : 0.28, 0.05, 1.5);

  return {
    gap,
    pad,
    openOffset: clamp(head, 0.02, 3),
    resumeGap: gap,
    minTotal,
    measured: { onsets: spans.length, medianGap: gap, medianPad: pad, headSeconds: head },
  };
}

/** Timing options a caller may still override, on top of the calibration. */
export interface TimingOverride {
  gap?: number;
  pad?: number;
  openOffset?: number;
  minTotal?: number;
}

export interface FittedTiming {
  timing: Timing;
  options: CalibratedTiming & { requestedGap: number; fitted: boolean };
  /** Seconds the end card had to hold to reach `minTotal` (0 when the layout reached it alone). */
  heldSeconds: number;
  /** How many gap steps the fitter had to take. 0 means the measured gap already fitted. */
  steps: number;
}

/**
 * Lay the voice out, then make the film reach the reference's runtime WITHOUT
 * stretching a single beat.
 *
 * `measureVoiceover` never invents or compresses a duration: it places the measured
 * lines on its own grid and, if the film comes up short of `minTotal`, holds the end
 * card. So the whole fit is one knob — the inter-line gap — walked down from the
 * measured value in 10 ms steps until the layout no longer overruns the reference.
 * The end card then holds the remainder, which is exactly the rule the video skill
 * already applies to a short read.
 *
 * Nothing here changes what any line says or how long it is on screen beyond the gap
 * between lines, and the fit is reported (`fitted`, `steps`, `heldSeconds`).
 */
export function fitTimingToRuntime(
  onsets: readonly VoOnset[],
  scenes: ReturnType<typeof scenePlanFor>,
  calibration: CalibratedTiming,
  override: TimingOverride = {},
): FittedTiming {
  const options: CalibratedTiming = {
    ...calibration,
    ...(override.gap !== undefined ? { gap: override.gap } : {}),
    ...(override.pad !== undefined ? { pad: override.pad } : {}),
    ...(override.openOffset !== undefined ? { openOffset: override.openOffset } : {}),
    ...(override.minTotal !== undefined ? { minTotal: override.minTotal } : {}),
  };
  const requestedGap = options.gap;

  const layout = (gap: number): Timing =>
    measureVoiceover(onsets, scenes, {
      gap,
      pad: options.pad,
      openOffset: options.openOffset,
      resumeGap: gap,
      minTotal: options.minTotal,
    });

  let steps = 0;
  let gap = requestedGap;
  let timing = layout(gap);
  // 10 ms steps, floor 20 ms: below that two lines are on top of each other.
  while (timing.total > options.minTotal + 0.001 && gap > 0.02 + 1e-9) {
    gap = roundTo(Math.max(0.02, gap - 0.01), 3);
    timing = layout(gap);
    steps++;
    if (steps > 400) break; // a guard, not a path: the floor is 20 ms away
  }

  // What the floor rule added: lay the SAME voice out with no floor at all, and the
  // difference is the end card's hold. Measured here rather than parsed out of the
  // note, so the figure in the report is the film's own numbers.
  const unfloored = measureVoiceover(onsets, scenes, {
    gap,
    pad: options.pad,
    openOffset: options.openOffset,
    resumeGap: gap,
    minTotal: 0,
  });
  const heldSeconds = roundTo(Math.max(0, timing.total - unfloored.total), 3);

  return {
    timing,
    options: { ...options, gap, requestedGap, fitted: steps > 0 },
    heldSeconds,
    steps,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// The beats file
// ────────────────────────────────────────────────────────────────────────────

export interface RebuildOverrides {
  /** Seeded id for the job. Defaults to `<basename-slug>-reverse`. */
  jobId?: string;
  /** Human-supplied brand card. Anything omitted stays a marked blank. */
  endCard?: {
    name?: string;
    tagline?: string;
    numbers?: [string, string];
    address?: string[];
    pledge?: string;
    logo?: string;
  };
  /** Human-supplied voice direction. The rebuild never calls a voice model. */
  voice?: { language?: string; speaker?: string; scene?: string; sampleContext?: string };
  /** Human-supplied on-screen words, keyed by shot id (`sh03`). Anything absent is a blank. */
  lines?: Record<string, string[]>;
  /** Override the shot→plate path template. Default `assets/src/<shot>.mp4`. */
  plateKey?: (shot: ShotFacts) => string;
  /** Override the calibrated timing knobs. */
  timing?: TimingOverride;
}

export interface RebuildPlan {
  /** The raw beats.json object, exactly as it will be written to disk. */
  raw: Record<string, unknown>;
  /** `parseBeats(raw)` — validated by the video skill's own contract. */
  beats: Beats;
  timing: Timing;
  project: EmittedProject;
  timing_options: FittedTiming['options'];
  heldSeconds: number;
  /** Which onsets the rebuild used, and which of them were off-grid. */
  onsets: { total: number; aligned: number; unaligned: number[]; dropped: number[] };
  notes: string[];
}

/** A filesystem-safe, seeded job id from the reference's name. */
export function jobIdFor(analysis: ReverseAnalysis, override?: string): string {
  if (override) return override;
  const slug = analysis.facts.basename
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
  const id = `${slug || 'reference'}-reverse`.slice(0, 64);
  return /^[a-z0-9][a-z0-9._-]{1,63}$/.test(id) ? id : 'reference-reverse';
}

/** The nearest rate the renderer actually emits. Stated, never assumed. */
export function nearestSupportedFps(fps: number): number {
  return SUPPORTED_FPS.reduce(
    (best, rate) => (Math.abs(rate - fps) < Math.abs(best - fps) ? rate : best),
    SUPPORTED_FPS[0],
  );
}

/**
 * A scene kind the rebuild can justify.
 *
 * There is no measurement that says "this shot is a list" — the emitter's shapes are
 * a craft choice. The rule is stated so it can be argued with: the last shot is the
 * end card (the contract requires it), the first shot that carries voice is the hook,
 * and everything else replaces its line at each reveal (`beat`) rather than stacking
 * rows (`list`/`info`/`numbers`), because stacking would eventually run past the safe
 * floor in a 9:16 frame.
 */
export function kindFor(onsetCount: number, isFirstVoiced: boolean, isLast: boolean): SceneKind {
  if (isLast) return 'endcard';
  if (isFirstVoiced && onsetCount > 0) return 'hook';
  return 'beat';
}

/**
 * Group one shot's measured onsets into beats that can actually hold a readable line.
 *
 * THE BUG THIS FIXES
 * One beat per onset is fine for a slow film. On a real fast-cut promo — the 61 s
 * 720x720 reference measured 41 onsets across 16 scenes — 21 of those lines are on
 * screen for 0.6–0.7 s, while the video skill's own readability floor is
 * `0.5 s + 0.3 s per word` (0.8 s for one word). The emitter therefore refuses the
 * whole film, which is correct: a word nobody can read is not a rebuild.
 *
 * So consecutive onsets that cannot each carry a word are merged into ONE beat whose
 * voice spans them. Nothing is invented and nothing is dropped: the voice is still the
 * reference's own audio, sliced over a longer window, and every line that IS drawn can
 * be read. The cost is that the rebuild has fewer beats than the reference has spoken
 * lines, and `compareBeats` reports that difference rather than hiding it.
 *
 * Both `buildBeats` and `voiceSlices` call this, so the beat→voice mapping is derived
 * the same way on both sides instead of being assumed.
 */
export interface OnsetGroup {
  entries: ShotOnset[];
  start: number;
  end: number;
}

export function groupShotOnsets(entries: readonly ShotOnset[], minHold: number, shotEnd?: number): OnsetGroup[] {
  const groups: OnsetGroup[] = [];

  for (const entry of entries) {
    const last = groups[groups.length - 1];
    // Absorb into the open group while that group is still too short to be read.
    if (last && roundTo(last.end - last.start, 3) < minHold) {
      last.entries.push(entry);
      last.end = Math.max(last.end, entry.span.end);
      continue;
    }
    groups.push({ entries: [entry], start: entry.span.start, end: entry.span.end });
  }

  // A trailing group that is still unreadable joins the one before it rather than
  // being emitted alone.
  if (groups.length > 1) {
    const last = groups[groups.length - 1];
    if (roundTo(last.end - last.start, 3) < minHold) {
      const previous = groups[groups.length - 2];
      previous.entries.push(...last.entries);
      previous.end = Math.max(previous.end, last.end);
      groups.pop();
    }
  }

  // Still short — because the shot ran out of onsets to merge with, or its one line is
  // genuinely 0.4 s long. Extend the beat into the SILENCE THAT FOLLOWS IT, up to the
  // next beat's first voice or the end of the shot.
  //
  // This invents nothing: the extra screen time is the reference's own quiet audio, so
  // the voice is unchanged and the words stay on the picture instead of being refused.
  // Without it, a fast-cut reference with one short line per shot can never be rebuilt,
  // because grouping has nothing left to merge.
  groups.forEach((group, index) => {
    const span = roundTo(group.end - group.start, 3);
    if (span >= minHold) return;
    const next = groups[index + 1];
    const limit = next ? next.start : (shotEnd ?? group.end);
    const target = Math.min(limit, roundTo(group.start + minHold, 3));
    if (target > group.end) group.end = roundTo(target, 3);
  });

  return groups;
}

/**
 * Turn one analysis into the raw beats file, plus the derivation notes that explain
 * every adjustment it had to make.
 */
function buildBeats(
  analysis: ReverseAnalysis,
  overrides: RebuildOverrides,
  options: { minHoldSeconds?: number } = {},
): { raw: Record<string, unknown>; notes: string[] } {
  const aspect = analysis.facts.aspect;
  const fps = nearestSupportedFps(analysis.facts.fps);
  const targetSeconds = Math.max(MIN_TARGET_SECONDS, roundTo(analysis.facts.durationSeconds, 2));
  const byShot = onsetsByShot(analysis);
  const firstVoicedShot = byShot.length ? byShot[0].shot.index : -1;
  const calibration = calibrateTiming(analysis);
  const layout = plateLayout(analysis);
  const absorbed = new Set(layout.absorbed);

  const plates = layout.groups.map((group) => ({
    id: group.id,
    source: 'asset' as const,
    key: overrides.plateKey
      ? overrides.plateKey(analysis.shots.find((shot) => shot.id === group.id) as ShotFacts)
      : `assets/src/${group.id}.mp4`,
    // s0 plays the head of this file, so the scene that follows enters at 0.5 s
    // instead of replaying the first half second under its own type.
    ...(group.mediaStart > 0 ? { mediaStart: group.mediaStart } : {}),
  }));

  const beats: Record<string, unknown>[] = [];
  const scenes: Record<string, unknown>[] = [];
  let beatSeq = 0;
  let sceneSeq = 0;
  let carry = 0;
  const notes: string[] = [];

  if (absorbed.size) {
    notes.push(
      `shot ${[...absorbed].join(', ')} is no longer than the ${LEAD_IN_SECONDS}s lead-in, so s0 plays it and the ` +
        `next shot's scene enters the same plate file at ${LEAD_IN_SECONDS}s: no frame of the reference is played ` +
        'twice and none is skipped',
    );
  }

  const shotList = analysis.shots.filter((shot) => !absorbed.has(shot.index));
  for (const [position, shot] of shotList.entries()) {
    const isLast = position === shotList.length - 1;
    const onsets = byShot.filter((entry) => entry.shot.index === shot.index);
    const kind = kindFor(onsets.length, shot.index === firstVoicedShot, isLast);
    const sceneId = `s${++sceneSeq}`;
    const plate = layout.shotToPlate[shot.index] ?? shot.id;
    // The lead-in is inside the first scene's plate when it belongs to that shot.
    const leadShare = shot.index === 1 ? LEAD_IN_SECONDS : 0;

    if (!onsets.length) {
      // A shot with no measured voice: a silent scene at its own measured length, less
      // the 0.5 s the lead-in is playing. `carry` moves a sub-minimum remainder onto
      // the next scene so the film still tiles exactly.
      let dur = roundTo(shot.dur + carry - leadShare, 3);
      if (dur < MIN_SILENT_SCENE_SECONDS) {
        carry = roundTo(dur - MIN_SILENT_SCENE_SECONDS, 3);
        notes.push(
          `shot ${shot.id} had only ${roundTo(dur, 3)}s of silent picture left after the lead-in; the ` +
            `${MIN_SILENT_SCENE_SECONDS}s minimum is lent from the next scene so the film still tiles exactly`,
        );
        dur = MIN_SILENT_SCENE_SECONDS;
      } else {
        carry = 0;
      }
      // A silent scene may be 0.5-12 s, so a longer shot becomes consecutive scenes.
      const chunks = Math.max(1, Math.ceil(dur / MAX_SILENT_SCENE_SECONDS));
      const each = roundTo(dur / chunks, 3);
      for (let chunk = 0; chunk < chunks; chunk++) {
        const id = chunk === 0 ? sceneId : `s${++sceneSeq}`;
        scenes.push({
          id,
          kind: chunk === chunks - 1 ? kind : 'beat',
          beats: [],
          plate,
          dur: chunk === chunks - 1 ? roundTo(dur - each * (chunks - 1), 3) : each,
        });
      }
      continue;
    }

    const beatIds: string[] = [];
    const minHold = options.minHoldSeconds ?? minHoldSeconds(1);
    const groups = groupShotOnsets(onsets, minHold, shot.end);
    for (const group of groups) {
      const box = shot.textBoxes[0];
      const geometryWords = box ? estimatedWords(box.width, box.height, aspect) : 1;
      // The hold this BEAT will get: the voice it spans, plus the gap to the next beat
      // (or the scene's pad, for the last one). Grouped onsets share one line, so the
      // line is sized against the whole group rather than one short burst.
      const spoken = roundTo(group.end - group.start, 3);
      // CONSERVATIVE ON PURPOSE: the line is sized against the VOICE it covers, not the
      // voice plus the gap and pad. The gap is what `fitTimingToRuntime` tightens when
      // the film overruns, so counting on it produced lines that were one word too long
      // for the clock they actually landed on (four words needing 1.7 s in a 1.5 s
      // window). Sizing against the voice alone can only ever under-count, and a line
      // that is too short is readable while one that is too long is refused.
      const holdGuess = spoken;
      const readable = wordsThatFit(holdGuess);
      if (group.entries.length > 1) {
        notes.push(
          `${group.entries.length} onsets in shot ${shot.id} (${group.entries
            .map((entry) => `${entry.span.dur}s`)
            .join(', ')}) are each shorter than the ${minHold}s one word needs, so they share one beat ` +
            `of ${spoken}s: the voice is unchanged and every drawn line stays readable`,
        );
      }
      const voiceSeconds = roundTo(
        group.entries.reduce((sum, entry) => sum + entry.span.dur, 0),
        3,
      );
      if (spoken > voiceSeconds + 1e-9) {
        // Said out loud: the beat is on screen longer than the voice inside it, because
        // the line would otherwise be too short to read. The extra time is the
        // reference's own quiet audio, so nothing has been invented.
        notes.push(
          `the beat at ${group.start}s in shot ${shot.id} holds for ${spoken}s where its voice is ` +
            `${voiceSeconds}s: it borrows ${roundTo(spoken - voiceSeconds, 3)}s of the reference's own silence ` +
            'so the line stays on the picture long enough to read',
        );
      }
      if (readable < 1) {
        notes.push(
          `the beat at ${group.start}s in shot ${shot.id} spans only ${spoken}s, under the ${minHold}s floor ` +
            'for one word; it keeps its voice and its line is reported as unreadable rather than silently shipped',
        );
      }
      const words = Math.max(1, Math.min(geometryWords, readable));
      const supplied = overrides.lines?.[shot.id];
      beatSeq++;
      const id = `p${String(beatSeq).padStart(2, '0')}`;
      beatIds.push(id);
      beats.push({
        id,
        // A blank, not a transcript: `vo` is what the video skill would send to a voice
        // model, and this pipeline has no transcript to send.
        vo: PLACEHOLDER_VO,
        lines: supplied && supplied.length ? supplied : [placeholderLine(words)],
        plate,
      });
    }
    // AN END CARD CANNOT ALSO CARRY LINES. The emitter draws a card's blocks INSTEAD of a
    // scene's beat lines, so when the reference's last shot IS the card, a line in it
    // keeps its VOICE and loses its WORDS.
    //
    // Splitting the card into a scene of its own is the right shape, and it was built and
    // measured twice: it needs time the reference does not have. On the owner's 61.353 s
    // reference the last spoken line ends at 61.353 s — a measured tail of ZERO — so a
    // 2.5 s card left its own "ADDRESS UNKNOWN" block at 1.081 s against the 1.1 s it
    // needs, and a 4 s card pushed a film line to 0.737 s against 0.8 s. Nothing gets both,
    // because there is nothing spare to give.
    //
    // So the card stays where it is and the loss is REPORTED, naming the lines, rather than
    // being silent. Giving the card real time means letting the film run longer than the
    // reference — a decision about what a rebuild is for, not something to assume for the
    // owner.
    if (kind === 'endcard' && beatIds.length > 0) {
      const tail = roundTo(Math.max(0, analysis.facts.durationSeconds - lastVoiceEnd(analysis)), 3);
      notes.push(
        `the end card draws its own blocks instead of a scene's lines, so ${beatIds.length} line(s) ` +
          `(${beatIds.join(', ')}) keep their voice and are not drawn. The reference has ${tail}s of picture ` +
          `after its last spoken line — not enough for a card of its own (a card needs about ` +
          `${END_CARD_SECONDS}s). If the words matter more than matching the runtime, ask for an end card that ` +
          'lengthens the film.',
      );
    }
    scenes.push({ id: sceneId, kind, beats: beatIds, plate });
  }

  const card = overrides.endCard ?? {};
  const raw: Record<string, unknown> = {
    version: 1,
    jobId: jobIdFor(analysis, overrides.jobId),
    aspect,
    fps,
    targetSeconds,
    onScreenLanguage: 'en',
    // No brand asset exists in the analysis, and an <img> with no file is a 404 at
    // render time, so the bug stays off unless a human supplies a logo.
    logoOnScreen: Boolean(card.logo),
    voice: {
      language: overrides.voice?.language ?? 'unknown',
      ...(overrides.voice?.speaker ? { speaker: overrides.voice.speaker } : {}),
      scene:
        overrides.voice?.scene ??
        'UNKNOWN - needs a human: the reference voice cannot be measured for tone from a container',
      ...(overrides.voice?.sampleContext ? { sampleContext: overrides.voice.sampleContext } : {}),
    },
    endCard: {
      name: card.name ?? PLACEHOLDER_BRAND,
      tagline: card.tagline ?? PLACEHOLDER_TAGLINE,
      numbers: card.numbers ?? PLACEHOLDER_NUMBERS,
      address: card.address ?? [PLACEHOLDER_ADDRESS],
      ...(card.pledge ? { pledge: card.pledge } : {}),
      ...(card.logo ? { logo: card.logo } : {}),
    },
    plates,
    beats,
    scenes,
  };

  return { raw, notes };
}

/**
 * The raw beats file for one analysis.
 *
 * Pure, and NOT trusted until `parseBeats` has accepted it — see
 * `rebuildFromAnalysis`, which is the entry point callers should use.
 */
export function beatsFromAnalysis(
  analysis: ReverseAnalysis,
  overrides: RebuildOverrides = {},
): Record<string, unknown> {
  return buildBeats(analysis, overrides).raw;
}

// ────────────────────────────────────────────────────────────────────────────
// Plates: the reference's own shots, and how the 0.5 s lead-in fits into them
// ────────────────────────────────────────────────────────────────────────────

/** The shortest silent scene the video skill's contract accepts. */
export const MIN_SILENT_SCENE_SECONDS = 0.5;
/** The longest one, before it has to be split. */
export const MAX_SILENT_SCENE_SECONDS = 12;

/**
 * Roughly how long an end card needs on screen for its four blocks to be read.
 *
 * Not used to place one — see the note where the card scene is built. It is the figure
 * the notes compare a reference's measured tail against, so an owner can see WHY their
 * reference cannot carry a card of its own.
 */
export const END_CARD_SECONDS = 2.5;

/** Where the reference's last spoken line ends. The picture after it is the only spare. */
export function lastVoiceEnd(analysis: ReverseAnalysis): number {
  return analysis.vo.spans.reduce((latest, span) => Math.max(latest, span.start + span.dur), 0);
}

export interface PlateGroup {
  /** Plate id = the shot id at the head of the group (`sh01`). */
  id: string;
  /** The span of the REFERENCE the plate file must cover, seconds. */
  start: number;
  end: number;
  /** Seconds into the plate where the scene that plays it enters. */
  mediaStart: number;
  /** Shot indices (1-based) this plate carries. */
  shots: number[];
  /** True when the first shot of the film is exactly the lead-in and rides in here. */
  absorbsLead: boolean;
}

export interface PlateLayout {
  groups: PlateGroup[];
  /** Shot index → plate id. */
  shotToPlate: Record<number, string>;
  /** Shots whose picture the lead-in already plays, so they get no scene of their own. */
  absorbed: number[];
}

/**
 * One plate per shot — except the first, where `s0` lives.
 *
 * A HyperFrames film opens on 0.5 s of plate with no overlay (the video skill's first
 * trap), so the reference's first half second plays TWICE if the first shot gets both
 * a lead-in and its own scene, and the film comes out 0.5 s long. The layout removes
 * that: `s0` plays the head of the first shot's plate, and the first shot's own scene
 * enters the SAME file at 0.5 s. When the reference's first shot is only the lead-in
 * itself, the plate covers it and the NEXT shot together and that shot's scene enters
 * at 0.5 s, so no frame of the reference is played twice and none is skipped.
 */
export function plateLayout(analysis: ReverseAnalysis): PlateLayout {
  const shots = analysis.shots;
  const groups: PlateGroup[] = [];
  const shotToPlate: Record<number, string> = {};
  const absorbed: number[] = [];
  if (!shots.length) return { groups, shotToPlate, absorbed };

  let index = 0;
  if (shots.length > 1 && shots[0].dur <= LEAD_IN_SECONDS + 1e-6) {
    groups.push({
      id: shots[0].id,
      start: shots[0].start,
      end: shots[1].end,
      mediaStart: LEAD_IN_SECONDS,
      shots: [shots[0].index, shots[1].index],
      absorbsLead: true,
    });
    absorbed.push(shots[0].index);
    shotToPlate[shots[1].index] = shots[0].id;
    index = 2;
  } else {
    groups.push({
      id: shots[0].id,
      start: shots[0].start,
      end: shots[0].end,
      mediaStart: LEAD_IN_SECONDS,
      shots: [shots[0].index],
      absorbsLead: false,
    });
    shotToPlate[shots[0].index] = shots[0].id;
    index = 1;
  }

  for (; index < shots.length; index++) {
    const shot = shots[index];
    groups.push({ id: shot.id, start: shot.start, end: shot.end, mediaStart: 0, shots: [shot.index], absorbsLead: false });
    shotToPlate[shot.index] = shot.id;
  }

  return { groups, shotToPlate, absorbed };
}

// ────────────────────────────────────────────────────────────────────────────
// Voice slices: where each beat's audio comes from in the reference
// ────────────────────────────────────────────────────────────────────────────

/**
 * The onsets the video skill's clock needs, and where each one sits in the
 * REFERENCE's audio — which is what the live harness slices into `assets/voice`.
 *
 * Beat order is shot order then onset order, which is exactly `onsetsByShot` order,
 * and `buildBeats` creates the beats in that same order.
 */
export function voiceSlices(
  analysis: ReverseAnalysis,
  raw: Record<string, unknown>,
): { id: string; start: number; dur: number }[] {
  const beats = Array.isArray(raw.beats) ? (raw.beats as { id: string }[]) : [];
  // The beats are one per GROUP of onsets, and how hard the voice was grouped depends
  // on how fast-cut the reference is — the rebuild raises the floor and tries again
  // when the emitter refuses its lines as too short. So the mapping is recovered FROM
  // THE BEATS FILE by finding the floor that produces exactly this many groups, rather
  // than assumed to be 1:1 or assumed to be the one-word minimum. Assuming either is
  // how a merged beat silently lost its voice and the film failed with "no measured
  // onset" on a beat that plainly has one.
  const groups = beatGroups(analysis, beats.length);
  if (beats.length !== groups.length) return [];
  return groups.map((group, index) => ({
    id: beats[index].id,
    start: group.start,
    dur: roundTo(group.end - group.start, 3),
  }));
}

/** The floors tried when recovering the grouping from a beats file. Monotonic. */
const GROUP_FLOOR_LADDER: readonly number[] = [0.8, 1.1, 1.4, 1.7, 2.0, 2.4, 2.8, 3.2, 3.6, 4.0, 4.6, 5.2, 6.0];

/** Every shot's onset groups at one floor, flattened in scene order. */
function groupsAtFloor(analysis: ReverseAnalysis, floor: number): OnsetGroup[] {
  const byShot = onsetsByShot(analysis);
  const perShot = new Map<number, ShotOnset[]>();
  for (const entry of byShot) {
    const list = perShot.get(entry.shot.index) ?? [];
    list.push(entry);
    perShot.set(entry.shot.index, list);
  }
  const ordered: OnsetGroup[] = [];
  for (const shotIndex of [...perShot.keys()].sort((a, b) => a - b)) {
    ordered.push(...groupShotOnsets(perShot.get(shotIndex) ?? [], floor, analysis.shots.find((s) => s.index === shotIndex)?.end));
  }
  return ordered;
}

/**
 * The grouping that produces `expectedCount` beats, or the one-word grouping when no
 * floor on the ladder matches.
 *
 * Grouping is monotonic in the floor (a higher floor never yields more groups), so the
 * smallest matching rung is the one the builder used.
 */
export function beatGroups(analysis: ReverseAnalysis, expectedCount?: number): OnsetGroup[] {
  const first = groupsAtFloor(analysis, GROUP_FLOOR_LADDER[0]);
  if (expectedCount === undefined || first.length === expectedCount) return first;

  for (const floor of GROUP_FLOOR_LADDER.slice(1)) {
    const groups = groupsAtFloor(analysis, floor);
    if (groups.length === expectedCount) return groups;
  }
  return first;
}

/** The onsets the clock is laid out from: one per spoken beat, in beat order. */
export function onsetsFromAnalysis(analysis: ReverseAnalysis, raw: Record<string, unknown>): VoOnset[] {
  return voiceSlices(analysis, raw).map((slice) => ({ id: slice.id, start: 0, dur: slice.dur }));
}

/**
 * The whole rebuild, in one pure call: raw beats → validated beats → measured clock
 * → emitted project.
 *
 * Everything it uses is imported from the `video` skill. The only thing this file
 * decides is which numbers to feed it, and it got those from `analyse.ts`.
 */
export function rebuildFromAnalysis(
  analysis: ReverseAnalysis,
  overrides: RebuildOverrides = {},
): RebuildPlan {
  const notes: string[] = [];
  const calibration = calibrateTiming(analysis);

  // Build, lay out the clock, and let the EMITTER judge readability — then try again
  // with longer beats if it refuses.
  //
  // The emitter's rule is `0.5 s + 0.3 s per word` on the hold it actually gives, which
  // depends on the gap that `fitTimingToRuntime` tightens to reach the reference's
  // runtime. Predicting that analytically means reimplementing the emitter; asking it
  // and reacting does not, and it cannot drift from the real rule because the real rule
  // IS the check. Each attempt raises the beat floor to what the refusal said the line
  // needed, so it converges in one or two steps on the films tried so far, and gives up
  // loudly rather than shipping something unreadable.
  const MAX_ATTEMPTS = 4;
  let minHold = minHoldSeconds(1);
  let raw: Record<string, unknown> = {};
  let beats: Beats | null = null;
  let timing = null as ReturnType<typeof fitTimingToRuntime>['timing'] | null;
  let fitted: ReturnType<typeof fitTimingToRuntime> | null = null;
  let project: EmittedProject | null = null;
  let attempts = 0;
  // The notes from the attempt that SUCCEEDED, plus the reason each earlier attempt was
  // rejected. Accumulating every attempt's notes verbatim repeated the whole derivation
  // once per retry, which reads as though the film has three end cards.
  let finalNotes: string[] = [];
  const retryNotes: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts = attempt;
    const derived = buildBeats(analysis, overrides, { minHoldSeconds: minHold });
    raw = derived.raw;
    finalNotes = derived.notes;

    const beatCount = Array.isArray(raw.beats) ? (raw.beats as unknown[]).length : 0;
    if (beatCount === 0) {
      throw new ReverseRebuildError(
        `no beat could be built: the reference has no measurable voice line, and the video skill requires at ` +
          `least one spoken beat (an empty "beats" array is refused, and every beat carries a voice track). ` +
          `${analysis.vo.reason} Reverse a reference that carries a voiceover, or supply the copy by hand and ` +
          `build the beats file directly — this pipeline has no transcript to invent one from.`,
        notes,
      );
    }

    beats = parseBeats(raw);
    const onsets = onsetsFromAnalysis(analysis, raw);
    fitted = fitTimingToRuntime(onsets, scenePlanFor(beats), calibration, overrides.timing ?? {});
    timing = fitted.timing;

    try {
      project = emitProject(beats, timing);
      break;
    } catch (error) {
      if (!(error instanceof EmitError)) throw error;
      // "… is on screen 0.707s but needs 0.8s (0.5s + 0.3s × 1 words)" — the number to
      // satisfy is stated by the checker itself.
      const needed = [...String(error.message).matchAll(/needs ([\d.]+)s/g)].map((match) => Number(match[1]));
      const raiseTo = needed.length ? Math.max(...needed) : roundTo(minHold + 0.4, 3);

      if (attempt === MAX_ATTEMPTS) {
        throw new ReverseRebuildError(
          `the reference is too fast-cut to rebuild as readable type after ${MAX_ATTEMPTS} attempts: ` +
            `${String(error.message).slice(0, 400)}. Every line must be on screen for 0.5 s + 0.3 s per word; ` +
            `grouping the voice harder would merge separate spoken lines into one, which is a different film. ` +
            'A reference shot this fast needs a human to write the lines for it.',
          notes,
        );
      }

      const nextFloor = roundTo(Math.max(raiseTo, minHold + 0.3), 3);
      retryNotes.push(
        `attempt ${attempt}: the emitter refused ${needed.length} line(s) as too short to read ` +
          `(the longest needs ${raiseTo}s). Grouping the voice into longer beats — floor ` +
          `${minHold}s → ${nextFloor}s — and laying the clock out again`,
      );
      minHold = nextFloor;
    }
  }

  if (!beats || !timing || !fitted || !project) {
    throw new ReverseRebuildError('the rebuild produced no project at all', notes);
  }

  // The successful attempt's derivation, then why the earlier ones were refused.
  notes.push(...finalNotes, ...retryNotes);

  const spoken = beats.beats.filter((beat) => beat.vo.length > 0).length;
  const unaligned = analysis.alignment.unaligned.map((entry) => entry.index);
  notes.push(
    `${spoken} spoken beat(s) from ${analysis.vo.spans.length} measured onset(s); ` +
      `${analysis.alignment.aligned.length} aligned to a cut` +
      (unaligned.length ? `, ${unaligned.length} placed by containment (onsets ${unaligned.join(', ')})` : ''),
  );
  notes.push(
    `timing calibrated from the reference: gap ${calibration.gap}s, pad ${calibration.pad}s, openOffset ` +
      `${calibration.openOffset}s (house defaults are 0.2 / 0.28 / 0.12)`,
  );
  if (fitted.options.fitted) {
    notes.push(
      `the measured ${fitted.options.requestedGap}s gap overran the reference's ${beats.targetSeconds}s runtime, so the ` +
        `gap was tightened to ${fitted.options.gap}s over ${fitted.steps} step(s) of 10ms — no beat was shortened, ` +
        'only the silence between beats',
    );
  }
  notes.push(
    `runtime: reference ${analysis.facts.durationSeconds}s, rebuild ${timing.total}s ` +
      `(${roundTo(timing.total - analysis.facts.durationSeconds, 3)}s) — compare.ts measures it, this file does not assert it`,
  );
  if (beats.fps !== analysis.facts.fps) {
    notes.push(
      `the reference runs at ${analysis.facts.fps} fps, which the renderer does not emit; the rebuild runs at ` +
        `${beats.fps} fps`,
    );
  }
  if (!analysis.vo.present) {
    notes.push(`no voice could be measured, so the rebuild carries picture and type only (${analysis.vo.reason})`);
  }
  if (beats.targetSeconds > analysis.facts.durationSeconds + 0.05) {
    notes.push(
      `the reference is ${analysis.facts.durationSeconds}s, under the ${MIN_TARGET_SECONDS}s floor, so the rebuild ` +
        `declares ${beats.targetSeconds}s and the end card holds the difference`,
    );
  }
  for (const note of timing.notes) notes.push(`timing: ${note}`);

  return {
    raw,
    beats,
    timing,
    project,
    timing_options: fitted.options,
    heldSeconds: fitted.heldSeconds,
    onsets: {
      total: analysis.vo.spans.length,
      aligned: analysis.alignment.aligned.length,
      unaligned,
      dropped: [],
    },
    notes,
  };
}

/** `beats.json`, deterministically serialised (2-space, trailing newline). */
export function beatsJsonText(plan: RebuildPlan): string {
  return `${JSON.stringify(plan.raw, null, 2)}\n`;
}
