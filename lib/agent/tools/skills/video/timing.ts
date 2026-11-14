/**
 * timing.ts — the measured clock.
 *
 * The reference film's timing file was never typed by hand: it was derived from
 * what the voiceover actually did (ffmpeg `silencedetect` on the trimmed wavs,
 * plus per-chunk pause offsets). This module is that step, made pure and
 * repeatable:
 *
 *     onsets (measured)      ->  timing.json (derived)
 *     [{ id, start, dur }]       { total, vo[], sceneList{}, s1{}, … }
 *
 * Two rules make the output trustworthy:
 *
 *  1. The function NEVER invents a duration. It only lays measured lines out on a
 *     fixed grid (a gap between lines, a lead before the first one) and cuts scene
 *     boundaries around them. A line that came back 2.66 s long is 2.66 s long.
 *  2. Every number is rounded once, through `roundTo`, so the same onsets produce
 *     a byte-identical timing file on any machine — no accumulated float drift
 *     that would make two "identical" renders differ by a frame.
 *
 * `s0` is always the 0.5 s plate-only lead-in: a scene on screen at t = 0 never
 * reveals its non-media `.clip` overlays, so the hook has to be a later scene.
 *
 * PURE: no I/O, no clock, no randomness.
 */

import {
  LEAD_IN_SECONDS,
  MIN_TARGET_SECONDS,
  roundTo,
  type SceneKind,
  type SceneSpec,
} from './beats';

/**
 * One measured voice line, as ffmpeg reported it.
 *
 * `start` is seconds from the beginning of the assembled voice track, `dur` the
 * speech itself. A line measured in its OWN file (which is how the pipeline renders
 * them) has `start: 0` and reports the silence that was trimmed in `lead`.
 */
export interface VoOnset {
  id: string;
  start: number;
  dur: number;
  /** Leading silence the trim removed, seconds. Diagnostic only. */
  lead?: number;
}

/** The clock's constants. All in seconds, all deliberate. */
export interface TimingOptions {
  /** Plate-only lead-in. Never 0 — see the header and trap 1. */
  leadIn: number;
  /** Silence between two spoken lines. */
  gap: number;
  /** How long after the lead-in the first line starts. */
  openOffset: number;
  /**
   * How far a line may start BEFORE its own scene cuts in.
   *
   * Scenes tile the film exactly (a gap renders black), so a scene boundary lands
   * where the previous line's pad ended. With a 0.2 s gap and a 0.28 s pad, the
   * next line naturally begins ~0.08 s before its picture cut — the voice leading
   * the cut is what the reference film does. Anything more than this is pulled
   * forward instead, so a slow line never lands on the wrong picture.
   */
  voiceLeadMax: number;
  /** Room after a scene's last line before the next scene's cut. */
  pad: number;
  /** Extra room after the end card's last line, so the card holds still. */
  endHold: number;
  /** Where the voice resumes after a silent scene. */
  resumeGap: number;
  /** Nothing is revealed on a scene's first frame; overlays need one frame of lead. */
  revealFloor: number;
  /** Below this the film is extended by holding the end card, not by stretching beats. */
  minTotal: number;
  /** Default length of a silent scene that does not state one. */
  silentDur: number;
}

export const TIMING_DEFAULTS: TimingOptions = {
  leadIn: LEAD_IN_SECONDS,
  gap: 0.2,
  openOffset: 0.12,
  voiceLeadMax: 0.15,
  pad: 0.28,
  endHold: 1.2,
  resumeGap: 0.34,
  revealFloor: 0.12,
  minTotal: MIN_TARGET_SECONDS,
  silentDur: 2.4,
};

/** How a scene ends up looking once the voice has been measured. */
export interface SceneTiming {
  dur: number;
  kind: SceneKind;
  /** Reveal time of each beat, relative to this scene's start. */
  beats: number[];
  /** When this scene's type starts leaving the frame. */
  out: number;
}

/** The derived clock. This IS timing.json, in typed form. */
export interface Timing {
  /** Last frame of the film = the last scene's end. */
  total: number;
  /** The laid-out voice: every spoken line with its absolute start. */
  vo: { id: string; start: number; dur: number }[];
  /** Every scene, contiguous and non-overlapping, starting with `s0` at 0. */
  sceneList: Record<string, { start: number; dur: number }>;
  /** Per-scene element timings, scene-relative. */
  scenes: Record<string, SceneTiming>;
  /** When the brand bug is on screen. */
  vobug: { start: number; end: number };
  /** The measurement, kept verbatim, so the derivation is auditable. */
  measured: VoOnset[];
  /** Largest |laid-out start − measured start|, seconds. */
  drift: number;
  /** Plain-language notes for the run log. */
  notes: string[];
  options: TimingOptions;
}

export class TimingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimingError';
    Object.setPrototypeOf(this, TimingError.prototype);
  }
}

/** A scene that will be cut, and the beats (voice lines) it carries. */
export interface ScenePlanEntry {
  scene: SceneSpec;
  /** Beat ids in reveal order. Empty for a silent scene. */
  beatIds: string[];
}

/**
 * Lay measured voice onsets out on the clock and cut scenes around them.
 *
 * The order of operations is the contract:
 *
 *   1. voice: line 1 starts at `leadIn + openOffset`; every later line starts at
 *      `previous end + gap`. This is the continuous stream the reference used.
 *   2. scenes TILE the film: each one starts exactly where the previous one ended
 *      (a gap renders as black). The boundary is derived from the voice — it lands
 *      where the previous scene's last line plus its pad finished — so a line can
 *      begin a fraction of a second before its own picture cut, which is what the
 *      reference film does on purpose.
 *   3. scene end = last line end + `pad` (`endHold` for the end card).
 *   4. a silent scene takes a fixed slice and pushes the voice cursor on by
 *      `resumeGap`, which is how a numbers beat can sit between two spoken lines.
 *   5. if the film is under `minTotal`, the END CARD holds longer. Beats are never
 *      stretched: that would desync the picture from the words.
 *
 * Throws `TimingError` when the input cannot be a clock: a duplicate id, a
 * non-positive duration, a spoken beat with no measurement, or a measurement for
 * a beat no scene carries.
 */
export function measureVoiceover(
  onsets: readonly VoOnset[],
  scenes: readonly ScenePlanEntry[],
  options: Partial<TimingOptions> = {},
): Timing {
  const o: TimingOptions = { ...TIMING_DEFAULTS, ...options };
  const notes: string[] = [];

  if (scenes.length === 0) {
    throw new TimingError('timing: needs at least one scene (the lead-in is added automatically)');
  }
  if (o.leadIn !== LEAD_IN_SECONDS) {
    // Guard rather than forbid: a caller may test the maths with another lead,
    // but the pipeline always uses 0.5 s and README/emit assume it.
    notes.push(`lead-in overridden to ${o.leadIn}s (the pipeline uses ${LEAD_IN_SECONDS}s)`);
  }

  const measuredById = new Map<string, VoOnset>();
  for (const onset of onsets) {
    if (!onset || typeof onset.id !== 'string' || !onset.id) {
      throw new TimingError('timing: every onset needs an id');
    }
    if (!Number.isFinite(onset.dur) || onset.dur <= 0) {
      throw new TimingError(
        `timing: onset "${onset.id}" has dur ${JSON.stringify(onset.dur)}; a measured line is > 0 s. ` +
          'An all-silent wav means the voice call returned nothing - re-render the line.',
      );
    }
    if (!Number.isFinite(onset.start) || onset.start < 0) {
      throw new TimingError(`timing: onset "${onset.id}" has start ${JSON.stringify(onset.start)}`);
    }
    if (measuredById.has(onset.id)) {
      throw new TimingError(`timing: onset "${onset.id}" appears twice`);
    }
    measuredById.set(onset.id, {
      id: onset.id,
      start: roundTo(onset.start, 3),
      dur: roundTo(onset.dur, 3),
      ...(onset.lead !== undefined && Number.isFinite(onset.lead)
        ? { lead: roundTo(onset.lead, 3) }
        : {}),
    });
  }

  const claimed = new Set<string>();
  for (const entry of scenes) {
    for (const id of entry.beatIds) {
      if (claimed.has(id)) throw new TimingError(`timing: beat "${id}" is planned in two scenes`);
      claimed.add(id);
    }
  }
  const unused = [...measuredById.keys()].filter((id) => !claimed.has(id));
  if (unused.length) {
    throw new TimingError(
      `timing: measured line(s) ${unused.join(', ')} belong to no scene. ` +
        'The voice was paid for; every measured line has to be placed.',
    );
  }

  const firstStart = [...measuredById.values()].sort((a, b) => a.start - b.start)[0];
  const absoluteMeasurement = [...measuredById.values()].some((onset) => onset.start > 0.001);
  if (absoluteMeasurement && firstStart && firstStart.start > 0.05) {
    notes.push(
      `first line starts at ${firstStart.start}s in the measured track: trim the leading silence ` +
        'before timing anything to it',
    );
  }

  const sceneList: Record<string, { start: number; dur: number }> = {
    s0: { start: 0, dur: roundTo(o.leadIn, 3) },
  };
  const sceneTimings: Record<string, SceneTiming> = {};
  const vo: { id: string; start: number; dur: number }[] = [];

  let cursor = roundTo(o.leadIn + o.openOffset, 3);
  let previousEnd = roundTo(o.leadIn, 3);
  const measuredStarts: { id: string; laidOut: number; measured: number }[] = [];

  for (const entry of scenes) {
    const ids = entry.beatIds;
    const lines = ids
      .map((id) => measuredById.get(id))
      .filter((v): v is VoOnset => Boolean(v));

    if (ids.length > 0 && lines.length !== ids.length) {
      const missing = ids.filter((id) => !measuredById.has(id));
      throw new TimingError(
        `timing: scene ${entry.scene.id} has spoken beat(s) ${missing.join(', ')} with no measured ` +
          'onset. Measure the rendered voiceover before planning the film.',
      );
    }

    if (ids.length === 0) {
      const dur = roundTo(Number(entry.scene.dur ?? o.silentDur), 3);
      if (!Number.isFinite(dur) || dur <= 0) {
        throw new TimingError(`timing: silent scene ${entry.scene.id} needs a positive dur`);
      }
      const start = previousEnd;
      sceneList[entry.scene.id] = { start, dur };
      sceneTimings[entry.scene.id] = {
        dur,
        kind: entry.scene.kind,
        beats: [],
        out: roundTo(Math.max(0, dur - 0.28), 3),
      };
      previousEnd = roundTo(start + dur, 3);
      cursor = roundTo(previousEnd + o.resumeGap, 3);
      continue;
    }

    const sceneStart = previousEnd;
    const reveals: number[] = [];

    for (const line of lines) {
      const start = cursor;
      vo.push({ id: line.id, start, dur: line.dur });
      measuredStarts.push({ id: line.id, laidOut: start, measured: line.start });
      reveals.push(roundTo(Math.max(o.revealFloor, start - sceneStart), 3));
      cursor = roundTo(start + line.dur + o.gap, 3);
    }

    const lastEnd = roundTo(cursor - o.gap, 3);
    const pad = entry.scene.kind === 'endcard' ? o.endHold : o.pad;
    const sceneEnd = roundTo(lastEnd + pad, 3);
    const dur = roundTo(sceneEnd - sceneStart, 3);

    sceneList[entry.scene.id] = { start: sceneStart, dur };
    sceneTimings[entry.scene.id] = {
      dur,
      kind: entry.scene.kind,
      beats: reveals,
      out: exitAt(dur, reveals, o),
    };
    previousEnd = sceneEnd;
    // The next line may lead its own picture cut by at most `voiceLeadMax`; more
    // than that would put a line under the previous scene.
    cursor = roundTo(Math.max(cursor, sceneEnd - o.voiceLeadMax), 3);
  }

  // ---- the film must reach its declared length, and it must reach it honestly
  const lastId = scenes[scenes.length - 1].scene.id;
  let total = roundTo(previousEnd, 3);
  if (total < o.minTotal) {
    const extra = roundTo(o.minTotal - total, 3);
    const last = sceneList[lastId];
    last.dur = roundTo(last.dur + extra, 3);
    sceneTimings[lastId] = {
      ...sceneTimings[lastId],
      dur: last.dur,
      out: exitAt(last.dur, sceneTimings[lastId].beats, o),
    };
    notes.push(
      `film was ${total}s; the end card holds ${extra}s longer to reach the ${o.minTotal}s floor ` +
        '(beats were not stretched, so the words stay on the picture)',
    );
    total = roundTo(last.start + last.dur, 3);
  }

  // Drift only means something when the onsets came from ONE continuous read. Each
  // line is normally rendered (and trimmed) in its own file, so its start is 0 and
  // there is no measured spacing to drift from — in which case the clock IS the
  // measurement and there is nothing to compare it against.
  const drift = absoluteMeasurement
    ? measuredStarts.reduce((max, line) => Math.max(max, Math.abs(line.laidOut - line.measured)), 0)
    : 0;
  if (drift > 0.35) {
    notes.push(
      `laid-out voice drifts ${roundTo(drift, 2)}s from the measured track: the onsets were measured ` +
        'on one continuous read, and the 0.2s gap rule re-times them',
    );
  }

  const lastSceneStart = sceneList[lastId].start;
  return {
    total,
    vo,
    sceneList,
    scenes: sceneTimings,
    vobug: { start: roundTo(o.leadIn, 3), end: roundTo(Math.max(o.leadIn, lastSceneStart), 3) },
    measured: [...measuredById.values()].sort((a, b) => a.start - b.start),
    drift: roundTo(drift, 3),
    notes,
    options: o,
  };
}

/** When a scene's type starts leaving: before the cut, after the last reveal. */
function exitAt(dur: number, reveals: readonly number[], o: TimingOptions): number {
  const lastReveal = reveals.length ? Math.max(...reveals) : 0;
  const wanted = Math.max(dur - 0.28, roundTo(lastReveal + 0.2, 3));
  return roundTo(Math.min(wanted, Math.max(0, dur - 0.04)), 3);
}

/**
 * The on-disk shape: `timing.json`.
 *
 * Per-scene detail is flattened onto the root as `s1`, `s2`, … exactly as the
 * reference film's measured timing file had it, because that file is the thing
 * this contract reproduces. `s0` stays in `sceneList` only — it carries no
 * overlay timings, by construction.
 */
export function toTimingJson(timing: Timing): Record<string, unknown> {
  const flat: Record<string, unknown> = {
    total: timing.total,
    vo: timing.vo,
    sceneList: timing.sceneList,
  };
  for (const id of Object.keys(timing.scenes)) {
    const scene = timing.scenes[id];
    flat[id] = { dur: scene.dur, kind: scene.kind, beats: scene.beats, out: scene.out };
  }
  flat.vobug = timing.vobug;
  flat.measured = timing.measured;
  flat.drift = timing.drift;
  return flat;
}

/** Deterministic serialisation of `timing.json` (2-space, trailing newline). */
export function timingJsonText(timing: Timing): string {
  return `${JSON.stringify(toTimingJson(timing), null, 2)}\n`;
}

/** True when every scene's element timings fall inside its own window. */
export function scenesSelfConsistent(timing: Timing): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  for (const [id, scene] of Object.entries(timing.scenes)) {
    for (const reveal of scene.beats) {
      if (!(reveal >= 0 && reveal < scene.dur)) {
        problems.push(`${id}: beat reveal ${reveal}s is outside its ${scene.dur}s window`);
      }
      if (reveal > scene.out) {
        problems.push(`${id}: beat reveal ${reveal}s lands after the scene's exit (${scene.out}s)`);
      }
    }
    if (!(scene.out <= scene.dur)) problems.push(`${id}: exit ${scene.out}s runs past ${scene.dur}s`);
  }
  const ids = Object.keys(timing.sceneList);
  for (let i = 1; i < ids.length; i++) {
    const prev = timing.sceneList[ids[i - 1]];
    const here = timing.sceneList[ids[i]];
    const prevEnd = roundTo(prev.start + prev.dur, 3);
    if (Math.abs(prevEnd - here.start) > 0.001) {
      problems.push(`${ids[i]} starts at ${here.start}s but ${ids[i - 1]} ends at ${prevEnd}s`);
    }
  }
  const last = timing.sceneList[ids[ids.length - 1]];
  if (Math.abs(roundTo(last.start + last.dur, 3) - timing.total) > 0.001) {
    problems.push(`total ${timing.total}s is not the last end ${roundTo(last.start + last.dur, 3)}s`);
  }
  if (timing.sceneList.s0?.dur !== LEAD_IN_SECONDS) {
    problems.push(`s0 is ${timing.sceneList.s0?.dur}s, must be exactly ${LEAD_IN_SECONDS}s`);
  }
  return { ok: problems.length === 0, problems };
}
