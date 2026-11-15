/**
 * analyse.ts — MEASURE a reference film, so it can be rebuilt instead of guessed.
 *
 * The `video` skill starts from a beats file a human wrote. This starts from an
 * MP4 that already exists and asks the only questions ffmpeg can answer:
 *
 *   container  duration, dimensions, frame rate, whether there is an audio stream
 *   cuts       ffmpeg `select='gt(scene,THRESHOLD)'` — a shot list, tiling the runtime
 *   voice      ffmpeg `silencedetect`, parsed by the video skill's own
 *              `parseSilenceDetect` (never a second parser), then aligned to cuts
 *   colour     per shot, the dominant colours of a few sampled frames, as hex
 *   type       per shot, the boxes where BRIGHT, HIGH-EDGE pixels cluster
 *
 * WHAT THIS MODULE CANNOT DO, STATED HERE RATHER THAN DISCOVERED LATER
 *
 *   - It cannot READ the reference's words. There is no OCR in this pipeline, so
 *     `textBoxes` are measured placement (a bounding region where type-shaped
 *     pixels are), never copy. `spec.ts` prints placement and marks the words
 *     `UNKNOWN — needs a human`; it never invents a headline.
 *   - It cannot name a brand colour, a typeface, a tempo or a phone number. Those
 *     are `UNKNOWN — needs a human` in the spec, by construction.
 *   - A music bed under the voice hides the onsets from `silencedetect` at the
 *     pipeline's default threshold, so the VO pass walks a documented ladder of
 *     thresholds and RECORDS which one worked. If none finds two distinct speech
 *     blocks the VO section is reported ABSENT — with the reason — rather than
 *     filled with invented lines.
 *
 * PURE WHERE IT CAN BE. Every parser and every piece of geometry here is a pure
 * function of its input, so `scripts/verify-reverse.ts` can pin the maths with
 * injected ffprobe/scene-detect text and no video file. The one impure function is
 * `analyseVideo`, and it receives its process seams (`AnalysisTools`) rather than
 * spawning ffmpeg itself.
 */

import { LEAD_IN_SECONDS, roundTo, SUPPORTED_FPS, type AspectRatio } from '../video/beats';
// Reuse, never reimplement: the video skill already owns the silencedetect filter
// and the parser for its output, and a second parser is how two measurements of the
// same audio start disagreeing.
import { SILENCE_DETECT_FILTER, parseSilenceDetect } from '../video/index';

// ────────────────────────────────────────────────────────────────────────────
// The knobs, all named, all defaults stated in the spec this module writes
// ────────────────────────────────────────────────────────────────────────────

/** Scene-change score a cut must beat. 0.20 finds the reference film's real cuts. */
export const DEFAULT_SCENE_THRESHOLD = 0.2;

/**
 * Shortest shot a cut is allowed to create. A boundary nearer than this to the
 * previous kept boundary (or to the end of the film) is DROPPED and listed in
 * `droppedBoundaries` — silently swallowing it would make the tiling a lie.
 */
export const DEFAULT_MIN_SHOT_SECONDS = 0.25;

/**
 * How far a measured voice onset may sit from the cut it is aligned to. 0.35 s is
 * ten frames at 30 fps: closer than the next nearest cut, and wide enough for the
 * voice-leads-the-picture convention the reference film uses on purpose.
 */
export const DEFAULT_ALIGN_TOLERANCE_SECONDS = 0.35;

/** `silencedetect` noise floor walked in order until two speech blocks appear. */
export const SILENCE_THRESHOLD_LADDER: readonly number[] = [-35, -25, -18, -15];

/** `silencedetect`'s minimum silence. The pipeline's own figure is 0.10 s. */
export const SILENCE_MIN_SECONDS = 0.08;

/** A measured speech block shorter than this is a click, not a line. */
export const MIN_SPEECH_SECONDS = 0.3;

/** How many frames are sampled per shot for palette + type placement. */
export const SAMPLES_PER_SHOT = 3;

/** Where in a shot those samples are taken, as a fraction of the shot. */
export const SAMPLE_FRACTIONS: readonly number[] = [0.2, 0.5, 0.8];

/** Long edge of the downscaled sample frame. Small, because only geometry survives. */
export const SAMPLE_LONG_EDGE = 216;

/** A type-placement cell, in SAMPLES px (so ~53 real px on a 1080-wide frame). */
export const TEXT_CELL_PX = 6;

/** Gradient magnitude a pixel needs before it can be type-shaped. */
export const TEXT_EDGE_MIN = 26;

/** Luma percentile a pixel must beat before it can be type-shaped (bright type). */
export const TEXT_BRIGHT_PERCENTILE = 0.9;

/** Share of a cell's pixels that must be type-shaped for the cell to count. */
export const TEXT_CELL_FILL = 0.1;

/** A candidate type box must span at least this share of the frame width. */
export const TEXT_MIN_WIDTH_SHARE = 0.12;

/**
 * A candidate type box may not be bigger than this share of the frame's area, nor
 * taller than this share of its height, nor squarer than this aspect ratio. Those
 * three bounds are what separate a LINE of type from a bright, busy piece of footage:
 * a lit window and a headline are both bright and both have edges.
 */
export const TEXT_MAX_AREA_SHARE = 0.3;
export const TEXT_MAX_HEIGHT_SHARE = 0.35;
export const TEXT_MIN_ASPECT = 1.2;

/** Candidate type boxes reported per shot. */
export const TEXT_MAX_BOXES = 3;

/** Swatches reported per shot / for the film. */
export const MAX_SWATCHES = 5;
export const MIN_SWATCHES = 3;

/** A colour bucket smaller than this share is noise, not a palette entry. */
export const MIN_SWATCH_SHARE_PERCENT = 1;

/** Two quantised buckets closer than this (RGB euclid) are one colour. */
export const SWATCH_MERGE_DISTANCE = 26;

// ────────────────────────────────────────────────────────────────────────────
// Types — the measurement, in the shape the spec and the rebuild consume
// ────────────────────────────────────────────────────────────────────────────

export interface MediaFacts {
  /** File name only: the spec is about the film, not about this machine. */
  basename: string;
  /** Seconds, as the container reports it. */
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  /** `fps` is one of the rates the renderer emits; false means the rebuild must snap. */
  fpsSupported: boolean;
  frameCount: number;
  hasAudio: boolean;
  videoCodec: string;
  audioCodec: string | null;
  sampleRate: number;
  channels: number;
  bytes: number;
  aspect: AspectRatio;
}

export interface SceneChange {
  /** Seconds. */
  time: number;
  /** The filter's own score (0-1 for `select`, 0-100 for `scdet`). */
  score: number;
}

export interface Shot {
  /** 1-based, so `shot 1` in the spec is `shots[0]` here without arithmetic. */
  index: number;
  /** `sh01` … Seeded, short, usable as a plate id and a file name. */
  id: string;
  start: number;
  end: number;
  dur: number;
}

export interface DroppedBoundary {
  time: number;
  why: string;
}

export interface Swatch {
  hex: string;
  sharePercent: number;
  rgb: [number, number, number];
}

export interface TextBox {
  /** In the downscaled sample, px. */
  sampleX: number;
  sampleY: number;
  sampleWidth: number;
  sampleHeight: number;
  /** In the real frame, px — rounded, so the spec can print them verbatim. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Right and bottom edges in the real frame, px. */
  right: number;
  bottom: number;
  /** 0-1 of the frame, at four decimal places. */
  xNorm: number;
  yNorm: number;
  widthNorm: number;
  heightNorm: number;
  /** Share of the frame's area this box covers, percent. */
  areaPercent: number;
  /** Share of the box's pixels that are type-shaped. */
  edgeDensity: number;
  /** Mean luma of the box, 0-255. */
  brightness: number;
}

export interface ShotFacts extends Shot {
  /** Film-level angle of this shot's position, for the spec's prose. */
  palette: Swatch[];
  meanLuma: number;
  textBoxes: TextBox[];
  /** True when this shot carries at least one candidate type box. */
  hasType: boolean;
}

export interface SpeechSpan {
  /** 1-based, in time order. */
  index: number;
  start: number;
  dur: number;
  end: number;
}

export interface LadderRung {
  /** The silencedetect noise floor, dB. */
  db: number;
  silenceCount: number;
  /** Distinct speech blocks this floor separated. */
  blocks: number;
  /** How many of those blocks START within the alignment tolerance of a cut. */
  alignedBlocks: number;
  speechSeconds: number;
  /** Median block length, seconds: a floor that splits lines into 0.2 s fragments is too hot. */
  medianBlockSeconds: number;
}

export interface VoSection {
  present: boolean;
  /**
   * The `silencedetect` noise floor `spans` came from, or null when no floor found
   * two speech blocks. Never guessed.
   */
  thresholdDb: number | null;
  /** Silence spans the chosen floor found. */
  silenceCount: number;
  spans: SpeechSpan[];
  totalSpeechSeconds: number;
  speechSharePercent: number;
  /** Every floor that was tried, with what it found. The choice is auditable here. */
  ladder: LadderRung[];
  /** Plain-language reason for `present` and for the chosen floor. */
  reason: string;
}

export interface AlignedOnset {
  index: number;
  start: number;
  dur: number;
  /** The shot whose cut this onset lands on, by id (`sh03`) — the index is beside it. */
  shot: string;
  shotIndex: number;
  /** Signed: negative when the voice leads the cut, which is deliberate. */
  deltaSeconds: number;
}

export interface UnalignedOnset {
  index: number;
  start: number;
  dur: number;
  /** The nearest cut, whether or not the onset aligned to it, by id (`sh03`). */
  nearestShot: string;
  shotIndex: number;
  deltaSeconds: number;
  why: string;
}

export interface Alignment {
  toleranceSeconds: number;
  aligned: AlignedOnset[];
  /** Reported, never dropped: an onset off the grid is still voice that was filmed. */
  unaligned: UnalignedOnset[];
}

/** A timecode the spec asks a human to look at, derived from the shot grid. */
export interface InspectionPoint {
  at: number;
  why: string;
}

export interface FilmFigures {
  shotCount: number;
  cutCount: number;
  /** Frames at the container's rate. */
  frameCount: number;
  /** Mean of the shots' mean luma, 0-255. */
  meanLuma: number;
  /** Dominant colours of the whole film, from every sampled frame. */
  palette: Swatch[];
  textBoxCount: number;
  /** Shots carrying at least one candidate type box. */
  typeShotCount: number;
  /** Share of the frame area carrying candidate type, averaged over all shots. */
  typeCoveragePercent: number;
  /** Mean candidate box width and height, in real frame px. */
  meanTypeWidth: number;
  meanTypeHeight: number;
  /**
   * The measured band the candidate type occupies, in real frame px: the topmost
   * box's top, the bottom-most box's bottom, and the extreme left/right edges. This
   * is what the spec calls the safe area, and it is measured, not assumed.
   */
  typeTopPx: number;
  typeBottomPx: number;
  typeLeftPx: number;
  typeRightPx: number;
  shortestShotSeconds: number;
  longestShotSeconds: number;
  /** Cuts per minute — the one honest description of a film's cutting rhythm. */
  cutsPerMinute: number;
  inspectionPoints: InspectionPoint[];
}

/** The whole measurement. This is the object the spec may not exceed. */
export interface ReverseAnalysis {
  version: 1;
  reference: { basename: string };
  facts: MediaFacts;
  sceneThreshold: number;
  minShotSeconds: number;
  samplesPerShot: number;
  sampleWidth: number;
  sampleHeight: number;
  changes: SceneChange[];
  droppedBoundaries: DroppedBoundary[];
  shots: ShotFacts[];
  film: FilmFigures;
  vo: VoSection;
  alignment: Alignment;
  notes: string[];
}

// ────────────────────────────────────────────────────────────────────────────
// ffmpeg command builders (strings, so a harness runs the exact command)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Scene detection, as the reference probe.
 *
 * `select` keeps only the frames that beat the threshold and `metadata=print`
 * logs each one's `pts_time` — that is the cut list. ffmpeg writes it to STDERR
 * (proven by running it), so the harness merges both streams.
 */
export function sceneDetectFilter(threshold = DEFAULT_SCENE_THRESHOLD): string {
  return `select='gt(scene,${threshold})',metadata=print`;
}

/** No video file, no analysis: the harness needs the container facts as JSON. */
export function probeArgs(file: string): string[] {
  return [
    '-v',
    'error',
    '-show_entries',
    'format=duration,size',
    '-show_entries',
    'stream=index,codec_type,codec_name,width,height,r_frame_rate,nb_frames,sample_rate,channels',
    '-of',
    'json',
    file,
  ];
}

/** The filter run whose stderr carries the measurement (cuts, or silences). */
export function logFilterArgs(file: string, filter: string): string[] {
  return ['-hide_banner', '-nostats', '-i', file, '-vf', filter, '-an', '-f', 'null', '-'];
}

/** The same, for an AUDIO filter. */
export function audioFilterArgs(file: string, filter: string): string[] {
  return ['-hide_banner', '-nostats', '-i', file, '-af', filter, '-vn', '-f', 'null', '-'];
}

/**
 * One downscaled frame as raw `rgb24`, written to `target`.
 *
 * Raw rather than PNG because there is no image decoder in this pipeline and there
 * is going to be no new dependency: 122×216×3 bytes of known layout is enough to
 * find the dominant colours and the type-shaped pixels of a frame.
 */
export function frameArgs(file: string, at: number, width: number, height: number, target: string): string[] {
  return [
    '-y',
    '-v',
    'error',
    '-ss',
    String(roundTo(at, 3)),
    '-i',
    file,
    '-frames:v',
    '1',
    '-vf',
    `scale=${width}:${height}:flags=area`,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    target,
  ];
}

/** Dimensions of the sample frame: long edge fixed, aspect preserved. */
export function sampleSize(width: number, height: number, longEdge = SAMPLE_LONG_EDGE): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`analyse: sampleSize needs positive dimensions (got ${width}x${height})`);
  }
  const scale = longEdge / Math.max(width, height);
  return {
    width: Math.max(TEXT_CELL_PX * 2, Math.round(width * scale)),
    height: Math.max(TEXT_CELL_PX * 2, Math.round(height * scale)),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Parsers (pure)
// ────────────────────────────────────────────────────────────────────────────

function fail(what: string): never {
  throw new Error(`analyse: ${what}`);
}

/** `30/1` → 30. A zero numerator (`0/0`) means "not a video rate". */
export function parseRate(rate: unknown): number {
  const text = String(rate ?? '').trim();
  const match = text.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (!match) {
    const value = Number(text);
    return Number.isFinite(value) && value > 0 ? roundTo(value, 3) : 0;
  }
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
  return roundTo(numerator / denominator, 3);
}

/** Aspect of a frame, as the two shapes the emitter can draw. */
export function aspectOf(width: number, height: number): AspectRatio {
  return height >= width ? '9:16' : '16:9';
}

/** `ffprobe -of json` → the facts. Throws rather than defaulting a missing duration. */
export function parseProbeJson(text: string, basename: string): MediaFacts {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(String(text)) as Record<string, unknown>;
  } catch {
    fail(`ffprobe did not return JSON (${String(text).slice(0, 200)})`);
  }

  const streams = Array.isArray(parsed.streams) ? (parsed.streams as Record<string, unknown>[]) : [];
  const format = (parsed.format ?? {}) as Record<string, unknown>;
  const video = streams.find((stream) => stream.codec_type === 'video');
  if (!video) fail(`${basename} has no video stream; there is nothing to reverse`);

  const duration = Number(format.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    fail(`ffprobe reported no usable duration for ${basename} (${JSON.stringify(format.duration)})`);
  }

  const width = Number(video.width);
  const height = Number(video.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    fail(`ffprobe reported no usable frame size for ${basename}`);
  }

  const fps = parseRate(video.r_frame_rate);
  if (fps <= 0) fail(`ffprobe reported no usable frame rate for ${basename}`);
  const declaredFrames = Number(video.nb_frames);
  const audio = streams.find((stream) => stream.codec_type === 'audio') ?? null;
  const bytes = Number(format.size);

  return {
    basename,
    durationSeconds: roundTo(duration, 3),
    width,
    height,
    fps,
    fpsSupported: SUPPORTED_FPS.includes(fps),
    // Some containers do not count video frames; the duration and the rate do.
    frameCount: Number.isFinite(declaredFrames) && declaredFrames > 0 ? declaredFrames : Math.round(duration * fps),
    hasAudio: Boolean(audio),
    videoCodec: String(video.codec_name ?? 'unknown'),
    audioCodec: audio ? String(audio.codec_name ?? 'unknown') : null,
    sampleRate: audio ? Number(audio.sample_rate ?? 0) || 0 : 0,
    channels: audio ? Number(audio.channels ?? 0) || 0 : 0,
    bytes: Number.isFinite(bytes) && bytes > 0 ? bytes : 0,
    aspect: aspectOf(width, height),
  };
}

/**
 * `metadata=print` output → the cuts.
 *
 * Two shapes are accepted because two filters produce them and both are real:
 *  - `select='gt(scene,…)'` logs `pts_time:3.6` then `lavfi.scene_score=0.4996`;
 *  - `scdet` logs `lavfi.scd.score=` / `lavfi.scd.time=` per frame.
 * Everything else in the log (banner, stream info, the `frame:` counter) is
 * ignored. A `pts_time` with no score after it is still a cut at score 1.
 */
export function parseSceneDetect(text: string): SceneChange[] {
  const out: SceneChange[] = [];
  let pendingTime: number | null = null;

  const flush = (score: number): void => {
    if (pendingTime === null) return;
    out.push({ time: roundTo(pendingTime, 3), score: roundTo(score, 4) });
    pendingTime = null;
  };

  for (const raw of String(text).split(/\r?\n/)) {
    const scdTime = raw.match(/lavfi\.scd\.time=\s*(-?[\d.]+)/);
    if (scdTime) {
      pendingTime = Math.max(0, Number(scdTime[1]));
      continue;
    }
    const pts = raw.match(/pts_time:\s*(-?[\d.]+)/);
    if (pts) {
      // A previous time with no score is a cut; commit it before moving on.
      flush(1);
      pendingTime = Math.max(0, Number(pts[1]));
      continue;
    }
    const score =
      raw.match(/lavfi\.scd\.score=\s*(-?[\d.]+)/) ?? raw.match(/lavfi\.scene_score=\s*(-?[\d.]+)/);
    if (score) {
      flush(Number(score[1]));
      continue;
    }
  }
  flush(1);

  return out
    .filter((change) => Number.isFinite(change.time))
    .sort((a, b) => a.time - b.time);
}

/**
 * Cuts → shots that TILE the runtime exactly.
 *
 * `shots[0]` starts at 0, each kept cut ends the shot before it and starts the next,
 * and the last shot ends at `durationSeconds` — so no gap can render black and no
 * overlap can play two plates at once. A cut too close to the previous kept cut, to
 * 0, or to the end is dropped *and reported*, because a 33 ms shot is a splice
 * artefact, not a shot.
 */
export function shotsFromChanges(
  changes: readonly SceneChange[],
  durationSeconds: number,
  options: { minShotSeconds?: number } = {},
): { shots: Shot[]; dropped: DroppedBoundary[] } {
  const minShot = options.minShotSeconds ?? DEFAULT_MIN_SHOT_SECONDS;
  const duration = roundTo(durationSeconds, 3);
  if (!Number.isFinite(duration) || duration <= 0) fail(`shotsFromChanges needs a positive duration (got ${durationSeconds})`);

  const dropped: DroppedBoundary[] = [];
  const kept: number[] = [];
  const sorted = [...changes].sort((a, b) => a.time - b.time);
  for (const change of sorted) {
    const at = roundTo(change.time, 3);
    if (!Number.isFinite(at) || at <= 0) {
      dropped.push({ time: at, why: 'at or before the first frame' });
      continue;
    }
    if (at >= duration) {
      dropped.push({ time: at, why: `at or past the end of the ${duration}s runtime` });
      continue;
    }
    const previous = kept.length ? kept[kept.length - 1] : 0;
    if (at - previous < minShot - 1e-9) {
      dropped.push({
        time: at,
        why: `${roundTo(at - previous, 3)}s after the previous cut (minimum shot is ${minShot}s)`,
      });
      continue;
    }
    if (duration - at < minShot - 1e-9) {
      dropped.push({ time: at, why: `${roundTo(duration - at, 3)}s before the end (minimum shot is ${minShot}s)` });
      continue;
    }
    kept.push(at);
  }

  const shots: Shot[] = [];
  let start = 0;
  for (const cut of [...kept, duration]) {
    const end = cut === duration ? duration : cut;
    if (end - start < 1e-9) continue;
    shots.push({
      index: shots.length + 1,
      id: `sh${String(shots.length + 1).padStart(2, '0')}`,
      start: roundTo(start, 3),
      end: roundTo(end, 3),
      dur: roundTo(end - start, 3),
    });
    start = end;
  }

  return { shots, dropped };
}

// ────────────────────────────────────────────────────────────────────────────
// Audio: silences → the speech blocks between them
// ────────────────────────────────────────────────────────────────────────────

/** The filter string the video skill already owns, at its own default floor. */
export function silenceFilter(noiseDb = -35, minSilence = SILENCE_MIN_SECONDS): string {
  if (noiseDb === -35 && Math.abs(minSilence - 0.1) < 1e-9) return SILENCE_DETECT_FILTER;
  return `silencedetect=noise=${noiseDb}dB:d=${minSilence}`;
}

/**
 * The speech blocks between measured silences.
 *
 * `silencedetect` reports what is QUIET; a film's beats are what is not. So the
 * voiced spans are the complement of the silence spans inside `[0, duration)`,
 * clipped, merged and rounded once. A block shorter than `minSpeechSeconds` is a
 * click and is dropped; nothing else is.
 */
export function speechSpans(
  silences: readonly { start: number; end: number }[],
  durationSeconds: number,
  options: { minSpeechSeconds?: number } = {},
): SpeechSpan[] {
  const minSpeech = options.minSpeechSeconds ?? MIN_SPEECH_SECONDS;
  const duration = roundTo(durationSeconds, 3);
  const quiet = silences
    .map((span) => ({
      start: Math.max(0, roundTo(span.start, 3)),
      end: Math.min(duration, roundTo(span.end, 3)),
    }))
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const span of quiet) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end + 1e-9) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }

  const spans: SpeechSpan[] = [];
  let cursor = 0;
  for (const span of merged) {
    if (span.start - cursor >= minSpeech) {
      spans.push({
        index: spans.length + 1,
        start: roundTo(cursor, 3),
        dur: roundTo(span.start - cursor, 3),
        end: roundTo(span.start, 3),
      });
    }
    cursor = Math.max(cursor, span.end);
  }
  if (duration - cursor >= minSpeech) {
    spans.push({
      index: spans.length + 1,
      start: roundTo(cursor, 3),
      dur: roundTo(duration - cursor, 3),
      end: roundTo(duration, 3),
    });
  }
  return spans;
}

/** Fewest distinct speech blocks that can be called a voiceover. */
export const MIN_ONSETS = 2;

/**
 * Align each measured onset to the nearest cut, and SAY when it does not fit.
 *
 * A voice line normally starts ON a cut (or a frame or two before it, the way the
 * reference film leads its picture). An onset further than the tolerance from every
 * cut is still real voice, so it is listed in `unaligned` with the distance that
 * disqualified it — reported, never dropped, never silently snapped.
 */
export function alignOnsets(
  spans: readonly SpeechSpan[],
  shots: readonly Shot[],
  toleranceSeconds = DEFAULT_ALIGN_TOLERANCE_SECONDS,
): Alignment {
  if (shots.length === 0) fail('alignOnsets needs at least one shot');

  const aligned: AlignedOnset[] = [];
  const unaligned: UnalignedOnset[] = [];

  for (const span of spans) {
    let nearest = shots[0];
    let best = Math.abs(span.start - shots[0].start);
    for (const shot of shots) {
      const distance = Math.abs(span.start - shot.start);
      // `<` keeps the EARLIER cut on a tie, which is the one the voice was cut to.
      if (distance < best - 1e-9) {
        best = distance;
        nearest = shot;
      }
    }
    const delta = roundTo(span.start - nearest.start, 3);
    if (best <= toleranceSeconds + 1e-9) {
      aligned.push({ index: span.index, start: span.start, dur: span.dur, shot: nearest.id, shotIndex: nearest.index, deltaSeconds: delta });
      continue;
    }
    unaligned.push({
      index: span.index,
      start: span.start,
      dur: span.dur,
      nearestShot: nearest.id,
      shotIndex: nearest.index,
      deltaSeconds: delta,
      why:
        `starts ${roundTo(best, 3)}s away from the nearest cut (${nearest.id} at ${nearest.start}s); ` +
        `the alignment tolerance is ${toleranceSeconds}s`,
    });
  }

  return { toleranceSeconds, aligned, unaligned };
}

// ────────────────────────────────────────────────────────────────────────────
// Pixels (pure over raw rgb24)
// ────────────────────────────────────────────────────────────────────────────

export interface FrameSample {
  width: number;
  height: number;
  /** `width * height * 3` bytes, rgb24, top-left first. */
  rgb: Uint8Array;
}

/** Rec. 601 luma, 0-255. Kept here so luma means one thing across this module. */
export function lumaOf(sample: FrameSample): Float32Array {
  const { rgb } = sample;
  const out = new Float32Array(sample.width * sample.height);
  for (let i = 0, p = 0; i < out.length; i++, p += 3) {
    out[i] = 0.299 * rgb[p] + 0.587 * rgb[p + 1] + 0.114 * rgb[p + 2];
  }
  return out;
}

export function meanLuma(luma: Float32Array): number {
  if (luma.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < luma.length; i++) sum += luma[i];
  return roundTo(sum / luma.length, 1);
}

function percentile(values: Float32Array, fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = Float32Array.from(values).sort();
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));
  return sorted[index];
}

const hex2 = (value: number): string => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');

export function toHex(r: number, g: number, b: number): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase();
}

/**
 * The dominant colours of a sampled frame, as hex + share.
 *
 * Colours are bucketed by the top five bits of each channel, the buckets are sorted
 * by how much of the frame they cover, and neighbouring buckets are merged so one
 * gradient does not eat five palette slots. Deterministic: equal counts break on
 * the bucket key.
 */
export function dominantColours(
  sample: FrameSample,
  options: { max?: number; min?: number; minSharePercent?: number } = {},
): Swatch[] {
  const max = options.max ?? MAX_SWATCHES;
  const min = options.min ?? MIN_SWATCHES;
  const minShare = options.minSharePercent ?? MIN_SWATCH_SHARE_PERCENT;
  const pixels = sample.width * sample.height;
  if (pixels === 0) return [];

  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let p = 0; p < sample.rgb.length; p += 3) {
    const r = sample.rgb[p];
    const g = sample.rgb[p + 1];
    const b = sample.rgb[p + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count++;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }

  const ordered = [...buckets.entries()]
    .map(([key, bucket]) => ({
      key,
      count: bucket.count,
      r: bucket.r / bucket.count,
      g: bucket.g / bucket.count,
      b: bucket.b / bucket.count,
    }))
    .sort((a, b) => (b.count === a.count ? a.key - b.key : b.count - a.count));

  const merged: { count: number; r: number; g: number; b: number }[] = [];
  for (const entry of ordered) {
    const near = merged.find((swatch) => {
      const dr = swatch.r - entry.r;
      const dg = swatch.g - entry.g;
      const db = swatch.b - entry.b;
      return Math.sqrt(dr * dr + dg * dg + db * db) < SWATCH_MERGE_DISTANCE;
    });
    if (near) {
      const total = near.count + entry.count;
      near.r = (near.r * near.count + entry.r * entry.count) / total;
      near.g = (near.g * near.count + entry.g * entry.count) / total;
      near.b = (near.b * near.count + entry.b * entry.count) / total;
      near.count = total;
      continue;
    }
    merged.push({ count: entry.count, r: entry.r, g: entry.g, b: entry.b });
  }

  // Merging re-weights the buckets, so the order is re-established afterwards: a
  // palette is printed in share order or it is not a palette.
  merged.sort((a, b) => b.count - a.count);
  const swatches: Swatch[] = [];
  for (const swatch of merged) {
    const sharePercent = roundTo((100 * swatch.count) / pixels, 1);
    if (swatches.length >= max) break;
    if (swatches.length >= min && sharePercent < minShare) break;
    swatches.push({
      hex: toHex(swatch.r, swatch.g, swatch.b),
      sharePercent,
      rgb: [Math.round(swatch.r), Math.round(swatch.g), Math.round(swatch.b)],
    });
  }
  return swatches;
}

/**
 * Where type-shaped pixels sit in one frame.
 *
 * A type pixel is BRIGHT (above the frame's own 90th luma percentile) AND on an
 * EDGE (a gradient over 26 of 255): that is what a white line of display type over
 * footage looks like from 216 px away. The mask is gridded into 6 px cells, cells
 * that are at least 10% type pixels are switched on, and each connected group of
 * cells becomes a candidate box. Boxes narrower than 12% of the frame are dropped
 * (that is a logo or a highlight, not a headline), and neighbouring boxes that
 * overlap horizontally and are close vertically are merged, because a two-line
 * headline is one block of type.
 *
 * THIS IS PLACEMENT, NOT COPY. Nothing here reads a word.
 */
export function textRegions(sample: FrameSample, frameWidth: number, frameHeight: number): TextBox[] {
  const { width, height } = sample;
  if (width < TEXT_CELL_PX * 2 || height < TEXT_CELL_PX * 2) return [];
  const luma = lumaOf(sample);
  const brightFloor = percentile(luma, TEXT_BRIGHT_PERCENTILE);

  const mask = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (luma[i] < brightFloor) continue;
      const gx = luma[i + 1] - luma[i - 1];
      const gy = luma[i + width] - luma[i - width];
      if (Math.abs(gx) + Math.abs(gy) >= TEXT_EDGE_MIN) mask[i] = 1;
    }
  }

  const cols = Math.floor(width / TEXT_CELL_PX);
  const rows = Math.floor(height / TEXT_CELL_PX);
  if (cols === 0 || rows === 0) return [];
  const cellOn = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let hits = 0;
      for (let y = 0; y < TEXT_CELL_PX; y++) {
        const row = (cy * TEXT_CELL_PX + y) * width + cx * TEXT_CELL_PX;
        for (let x = 0; x < TEXT_CELL_PX; x++) hits += mask[row + x];
      }
      if (hits / (TEXT_CELL_PX * TEXT_CELL_PX) >= TEXT_CELL_FILL) cellOn[cy * cols + cx] = 1;
    }
  }

  // Connected components over the cell grid (4-neighbour, explicit stack).
  interface Box {
    c0: number;
    c1: number;
    r0: number;
    r1: number;
  }
  const seen = new Uint8Array(cols * rows);
  const boxes: Box[] = [];
  for (let start = 0; start < cellOn.length; start++) {
    if (!cellOn[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    const box: Box = {
      c0: start % cols,
      c1: start % cols,
      r0: Math.floor(start / cols),
      r1: Math.floor(start / cols),
    };
    while (stack.length) {
      const at = stack.pop() as number;
      const cx = at % cols;
      const cy = Math.floor(at / cols);
      box.c0 = Math.min(box.c0, cx);
      box.c1 = Math.max(box.c1, cx);
      box.r0 = Math.min(box.r0, cy);
      box.r1 = Math.max(box.r1, cy);
      const neighbours = [
        cx > 0 ? at - 1 : -1,
        cx < cols - 1 ? at + 1 : -1,
        cy > 0 ? at - cols : -1,
        cy < rows - 1 ? at + cols : -1,
      ];
      for (const next of neighbours) {
        if (next < 0 || seen[next] || !cellOn[next]) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    boxes.push(box);
  }

  // Merge boxes that stack vertically with horizontal overlap (one headline, two lines).
  const mergedBoxes: Box[] = [];
  for (const box of boxes.sort((a, b) => (a.r0 === b.r0 ? a.c0 - b.c0 : a.r0 - b.r0))) {
    const host = mergedBoxes.find((other) => {
      const gap = box.r0 > other.r1 ? box.r0 - other.r1 : other.r0 - box.r1;
      if (gap > 1) return false;
      const overlap = Math.min(box.c1, other.c1) - Math.max(box.c0, other.c0) + 1;
      const narrowest = Math.min(box.c1 - box.c0, other.c1 - other.c0) + 1;
      return overlap >= narrowest * 0.5;
    });
    if (host) {
      host.c0 = Math.min(host.c0, box.c0);
      host.c1 = Math.max(host.c1, box.c1);
      host.r0 = Math.min(host.r0, box.r0);
      host.r1 = Math.max(host.r1, box.r1);
      continue;
    }
    mergedBoxes.push({ ...box });
  }

  const scaleX = frameWidth / width;
  const scaleY = frameHeight / height;
  const minWidthCells = Math.max(2, Math.ceil((TEXT_MIN_WIDTH_SHARE * width) / TEXT_CELL_PX));

  const measured = mergedBoxes
    .filter((box) => box.c1 - box.c0 + 1 >= minWidthCells)
    .map((box) => {
      const sampleX = box.c0 * TEXT_CELL_PX;
      const sampleY = box.r0 * TEXT_CELL_PX;
      const sampleWidth = (box.c1 - box.c0 + 1) * TEXT_CELL_PX;
      const sampleHeight = (box.r1 - box.r0 + 1) * TEXT_CELL_PX;

      let hits = 0;
      let sum = 0;
      for (let y = sampleY; y < Math.min(height, sampleY + sampleHeight); y++) {
        for (let x = sampleX; x < Math.min(width, sampleX + sampleWidth); x++) {
          const i = y * width + x;
          hits += mask[i];
          sum += luma[i];
        }
      }
      const cells = sampleWidth * sampleHeight;
      const x = Math.round(sampleX * scaleX);
      const y = Math.round(sampleY * scaleY);
      const w = Math.round(sampleWidth * scaleX);
      const h = Math.round(sampleHeight * scaleY);
      return {
        sampleX,
        sampleY,
        sampleWidth,
        sampleHeight,
        x,
        y,
        width: w,
        height: h,
        right: x + w,
        bottom: y + h,
        xNorm: roundTo(x / frameWidth, 4),
        yNorm: roundTo(y / frameHeight, 4),
        widthNorm: roundTo(w / frameWidth, 4),
        heightNorm: roundTo(h / frameHeight, 4),
        areaPercent: roundTo((100 * w * h) / (frameWidth * frameHeight), 2),
        edgeDensity: roundTo(hits / Math.max(1, cells), 4),
        brightness: roundTo(sum / Math.max(1, cells), 1),
      } satisfies TextBox;
    })
    .filter(
      (box) =>
        box.width > 0 &&
        box.height > 0 &&
        box.areaPercent <= TEXT_MAX_AREA_SHARE * 100 &&
        box.heightNorm <= TEXT_MAX_HEIGHT_SHARE &&
        box.width / box.height >= TEXT_MIN_ASPECT,
    )
    .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));

  return measured.slice(0, TEXT_MAX_BOXES);
}

// ────────────────────────────────────────────────────────────────────────────
// The one impure function: everything above, wired to injected tools
// ────────────────────────────────────────────────────────────────────────────

/**
 * The process seams. `analyseVideo` never spawns anything itself, so the whole
 * measurement can be driven from a test, a sandbox, or a local harness.
 */
export interface AnalysisTools {
  /** `ffprobe` JSON for `file`. */
  probeJson(file: string): Promise<string>;
  /** Merged stdout+stderr of an ffmpeg run (scene detect, silencedetect). */
  log(file: string, filter: string, kind: 'video' | 'audio'): Promise<string>;
  /** One downscaled frame at `at` seconds, as raw rgb24. */
  frameRgb(file: string, at: number, width: number, height: number): Promise<Uint8Array>;
}

export interface AnalyseOptions {
  sceneThreshold?: number;
  minShotSeconds?: number;
  toleranceSeconds?: number;
  samplesPerShot?: number;
  thresholds?: readonly number[];
}

/**
 * Measure one reference film.
 *
 * Order matters and is the contract:
 *   1. container facts, and the sample geometry derived from them;
 *   2. cuts, then the shot list that tiles the runtime;
 *   3. per shot: sampled frames → palette, mean luma, candidate type boxes;
 *   4. the voice: `silencedetect` up the threshold ladder → speech blocks;
 *   5. those blocks aligned to the cuts, aligned and unaligned both reported;
 *   6. the film-level figures and the inspection points the spec will print.
 */
export async function analyseVideo(
  file: string,
  tools: AnalysisTools,
  options: AnalyseOptions = {},
): Promise<ReverseAnalysis> {
  const sceneThreshold = options.sceneThreshold ?? DEFAULT_SCENE_THRESHOLD;
  const minShotSeconds = options.minShotSeconds ?? DEFAULT_MIN_SHOT_SECONDS;
  const toleranceSeconds = options.toleranceSeconds ?? DEFAULT_ALIGN_TOLERANCE_SECONDS;
  const samplesPerShot = Math.max(1, Math.min(SAMPLE_FRACTIONS.length, options.samplesPerShot ?? SAMPLES_PER_SHOT));
  const thresholds = options.thresholds ?? SILENCE_THRESHOLD_LADDER;
  const notes: string[] = [];

  const basename = file.split(/[\\/]/).pop() ?? file;
  const facts = parseProbeJson(await tools.probeJson(file), basename);
  const sample = sampleSize(facts.width, facts.height);

  // ── 2. cuts -> shots that tile the runtime
  const changes = parseSceneDetect(await tools.log(file, sceneDetectFilter(sceneThreshold), 'video'));
  const { shots: rawShots, dropped } = shotsFromChanges(changes, facts.durationSeconds, { minShotSeconds });
  if (dropped.length) {
    notes.push(
      `${dropped.length} boundary(ies) dropped from the raw cut list (${dropped
        .map((entry) => `${entry.time}s: ${entry.why}`)
        .join('; ')})`,
    );
  }

  // ── 3. per-shot colour + type placement
  const fractions = SAMPLE_FRACTIONS.slice(0, samplesPerShot);
  const shots: ShotFacts[] = [];
  const filmSamples: Uint8Array[] = [];

  for (const shot of rawShots) {
    const shotsSamples: FrameSample[] = [];
    for (const fraction of fractions) {
      const at = roundTo(shot.start + shot.dur * fraction, 3);
      // Never seek past the last frame: a sample at `duration` reads nothing.
      const safeAt = Math.min(Math.max(0, at), Math.max(0, facts.durationSeconds - 0.05));
      const rgb = await tools.frameRgb(file, safeAt, sample.width, sample.height);
      const expected = sample.width * sample.height * 3;
      if (rgb.length < expected) {
        throw new Error(
          `analyse: ffmpeg returned ${rgb.length} bytes for a ${sample.width}x${sample.height} sample at ` +
            `${safeAt}s (expected ${expected}); the frame extraction is not working`,
        );
      }
      const frame: FrameSample = { width: sample.width, height: sample.height, rgb: rgb.subarray(0, expected) };
      shotsSamples.push(frame);
      filmSamples.push(frame.rgb);
    }

    // Palette AND type placement come off the middle sample of the shot: the
    // first and last frames of a shot are the ones a transition touches.
    const middle = shotsSamples[Math.floor(shotsSamples.length / 2)];
    const palette = dominantColours(middle);
    const textBoxes = textRegions(middle, facts.width, facts.height);
    const luma = meanLuma(lumaOf(middle));
    shots.push({ ...shot, palette, meanLuma: luma, textBoxes, hasType: textBoxes.length > 0 });
  }

  // The film-level palette is taken over every sampled frame at once, so a colour
  // that owns one shot cannot outvote a colour that owns the film. The sample is
  // stacked vertically (`height * samples`) only because `dominantColours` divides
  // by `width * height` to get its shares.
  const total = filmSamples.reduce((sum, bytes) => sum + bytes.length, 0);
  const stacked = new Uint8Array(total);
  let offset = 0;
  for (const bytes of filmSamples) {
    stacked.set(bytes, offset);
    offset += bytes.length;
  }
  const filmPixels: FrameSample = {
    width: sample.width,
    height: sample.height * Math.max(1, filmSamples.length),
    rgb: stacked,
  };

  // ── 4. the voice
  const vo = await measureVoice(file, facts, tools, thresholds, rawShots, toleranceSeconds);

  // ── 5. alignment
  const alignment = alignOnsets(vo.spans, rawShots, toleranceSeconds);
  if (alignment.unaligned.length) {
    notes.push(
      `${alignment.unaligned.length} measured onset(s) fall further than ${toleranceSeconds}s from every cut and ` +
        'are reported rather than snapped: ' +
        alignment.unaligned.map((onset) => `#${onset.index} at ${onset.start}s (${onset.deltaSeconds}s)`).join(', '),
    );
  }

  // ── 6. film-level figures
  const typeShots = shots.filter((shot) => shot.hasType);
  const typeBoxes = shots.flatMap((shot) => shot.textBoxes);
  const coverage = shots.length
    ? roundTo(
        shots.reduce((sum, shot) => sum + shot.textBoxes.reduce((area, box) => area + box.areaPercent, 0), 0) /
          shots.length,
        2,
      )
    : 0;
  const film: FilmFigures = {
    shotCount: shots.length,
    cutCount: Math.max(0, shots.length - 1),
    frameCount: facts.frameCount,
    meanLuma: shots.length ? roundTo(shots.reduce((sum, shot) => sum + shot.meanLuma, 0) / shots.length, 1) : 0,
    palette: dominantColours(filmPixels),
    textBoxCount: typeBoxes.length,
    typeShotCount: typeShots.length,
    typeCoveragePercent: coverage,
    meanTypeWidth: typeBoxes.length
      ? Math.round(typeBoxes.reduce((sum, box) => sum + box.width, 0) / typeBoxes.length)
      : 0,
    meanTypeHeight: typeBoxes.length
      ? Math.round(typeBoxes.reduce((sum, box) => sum + box.height, 0) / typeBoxes.length)
      : 0,
    typeTopPx: typeBoxes.length ? Math.min(...typeBoxes.map((box) => box.y)) : 0,
    typeBottomPx: typeBoxes.length ? Math.max(...typeBoxes.map((box) => box.y + box.height)) : 0,
    typeLeftPx: typeBoxes.length ? Math.min(...typeBoxes.map((box) => box.x)) : 0,
    typeRightPx: typeBoxes.length ? Math.max(...typeBoxes.map((box) => box.x + box.width)) : 0,
    shortestShotSeconds: shots.length ? Math.min(...shots.map((shot) => shot.dur)) : 0,
    longestShotSeconds: shots.length ? Math.max(...shots.map((shot) => shot.dur)) : 0,
    cutsPerMinute: roundTo((Math.max(0, shots.length - 1) / facts.durationSeconds) * 60, 1),
    inspectionPoints: inspectionPoints(shots, facts.durationSeconds),
  };

  if (!facts.fpsSupported) {
    notes.push(
      `the container runs at ${facts.fps} fps, which the renderer does not emit (${SUPPORTED_FPS.join('/')}); ` +
        'the rebuild snaps to the nearest supported rate and frame counts will differ',
    );
  }
  notes.push(vo.reason);

  return {
    version: 1,
    reference: { basename },
    facts,
    sceneThreshold,
    minShotSeconds,
    samplesPerShot: fractions.length,
    sampleWidth: sample.width,
    sampleHeight: sample.height,
    changes,
    droppedBoundaries: dropped,
    shots,
    film,
    vo,
    alignment,
    notes,
  };
}

/**
 * The VO pass: walk the threshold ladder and choose the floor whose speech blocks
 * START ON CUTS.
 *
 * Each rung is a REAL silencedetect run over the whole file, and every rung's result
 * is kept in `vo.ladder` so the choice can be argued with. The choice itself is not
 * "the first rung that finds anything": a music bed makes a low floor separate two
 * enormous blocks that are really one continuous mix, and calling that a voiceover
 * puts one beat across twelve shots. So each rung is scored by how many of its blocks
 * begin within the alignment tolerance of a measured cut — which is the definition of
 * a beat map — then by how finely it splits the voice, then by preferring the quieter
 * floor.
 */
async function measureVoice(
  file: string,
  facts: MediaFacts,
  tools: AnalysisTools,
  thresholds: readonly number[],
  shots: readonly Shot[],
  toleranceSeconds: number,
): Promise<VoSection> {
  const absent = (reason: string, ladder: LadderRung[] = []): VoSection => ({
    present: false,
    thresholdDb: null,
    silenceCount: 0,
    spans: [],
    totalSpeechSeconds: 0,
    speechSharePercent: 0,
    ladder,
    reason,
  });

  if (!facts.hasAudio) {
    return absent(
      `${facts.basename} carries no audio stream, so no voiceover could be measured; the VO section is absent ` +
        'rather than invented',
    );
  }

  const ladder: LadderRung[] = [];
  const candidates: { rung: LadderRung; spans: SpeechSpan[] }[] = [];

  for (const db of thresholds) {
    const text = await tools.log(file, silenceFilter(db), 'audio');
    const silences = parseSilenceDetect(text);
    const spans = speechSpans(silences, facts.durationSeconds);
    const aligned = alignOnsets(spans, shots, toleranceSeconds);
    const rung: LadderRung = {
      db,
      silenceCount: silences.length,
      blocks: spans.length,
      alignedBlocks: aligned.aligned.length,
      speechSeconds: roundTo(spans.reduce((sum, span) => sum + span.dur, 0), 3),
      medianBlockSeconds: spans.length
        ? roundTo([...spans.map((span) => span.dur)].sort((a, b) => a - b)[Math.floor(spans.length / 2)], 3)
        : 0,
    };
    ladder.push(rung);
    if (spans.length >= MIN_ONSETS) candidates.push({ rung, spans });
  }

  if (!candidates.length) {
    return absent(
      `no noise floor between ${thresholds[0]} dB and ${thresholds[thresholds.length - 1]} dB separated ` +
        `${MIN_ONSETS} distinct speech blocks: the mix is continuous (a music bed under the voice), so the VO ` +
        'section is absent rather than invented',
      ladder,
    );
  }

  candidates.sort(
    (a, b) =>
      b.rung.alignedBlocks - a.rung.alignedBlocks ||
      b.rung.blocks - a.rung.blocks ||
      a.rung.db - b.rung.db,
  );
  const chosen = candidates[0];
  const total = roundTo(chosen.spans.reduce((sum, span) => sum + span.dur, 0), 3);

  return {
    present: true,
    thresholdDb: chosen.rung.db,
    silenceCount: chosen.rung.silenceCount,
    spans: chosen.spans,
    totalSpeechSeconds: total,
    speechSharePercent: roundTo((100 * total) / facts.durationSeconds, 1),
    ladder,
    reason:
      `voiceover measured at a ${chosen.rung.db} dB noise floor: ${chosen.spans.length} speech block(s), ` +
      `${total}s of speech (${roundTo((100 * total) / facts.durationSeconds, 1)}% of the runtime), ` +
      `${chosen.rung.alignedBlocks} of them starting on a cut` +
      (chosen.rung.db !== thresholds[0]
        ? `; the default ${thresholds[0]} dB floor was not chosen (it found ${ladder[0].blocks} block(s))`
        : ''),
  };
}

/**
 * Timecodes a human should look at, derived from the measured grid: the first
 * frame, each shot's mid-point, and the last frame. `spec.ts` prints these and may
 * not print any timecode that is not in here.
 */
export function inspectionPoints(shots: readonly Shot[], durationSeconds: number): InspectionPoint[] {
  const points: InspectionPoint[] = [{ at: 0.2, why: 'the first frame of the film' }];
  for (const shot of shots) {
    points.push({ at: roundTo(shot.start + shot.dur / 2, 2), why: `the middle of shot ${shot.index}` });
  }
  points.push({ at: roundTo(Math.max(0.2, durationSeconds - 0.5), 2), why: 'the last held frame' });
  const unique = new Map<number, InspectionPoint>();
  for (const point of points) {
    if (point.at > 0 && point.at < durationSeconds) unique.set(point.at, point);
  }
  return [...unique.values()].sort((a, b) => a.at - b.at);
}

/** Where the rebuild's own lead-in ends: `s0` is 0.5 s of plate, always. */
export const REBUILD_LEAD_IN_SECONDS = LEAD_IN_SECONDS;
