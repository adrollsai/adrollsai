/**
 * compare.ts — reference vs rebuild, as numbers and as frames side by side.
 *
 * A rebuild is only worth anything if it can be checked against the thing it copied,
 * so this module answers three questions and refuses to answer them vaguely:
 *
 *   1. is the runtime the same?   `compareRuntime` — same within ±0.3 s, or the drift.
 *   2. is the beat count the same? `compareBeats` — every measured onset present, or
 *      how many went missing.
 *   3. what do the frames actually look like? `framePairs` picks the timecodes,
 *      `meanAbsoluteDifference` scores a pair numerically, and
 *      `contactSheetCommand` writes them side by side (reference LEFT, rebuild
 *      RIGHT) into one sheet a human can read at a glance.
 *
 * The numeric difference is deliberately boring: mean absolute per-channel
 * difference over raw rgb24, plus its share of full scale and a PSNR. It says "these
 * two frames are 81% different", which is the truth when a rebuild uses the
 * reference's own plates under a different grade, and it says nothing at all about
 * whether the rebuild is GOOD. The contact sheet is what answers that, and it is
 * meant to be looked at.
 *
 * PURE except for nothing: the maths is pure, and the ffmpeg commands are built as
 * STRINGS for a harness to run. This module never spawns a process.
 */

export const DEFAULT_RUNTIME_TOLERANCE_SECONDS = 0.3;

const round = (value: number, dp = 3): number => {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
};

// ────────────────────────────────────────────────────────────────────────────
// 1. Runtime
// ────────────────────────────────────────────────────────────────────────────

export interface RuntimeComparison {
  referenceSeconds: number;
  rebuildSeconds: number;
  /** Rebuild minus reference: positive means the rebuild runs long. */
  driftSeconds: number;
  absoluteDriftSeconds: number;
  toleranceSeconds: number;
  withinTolerance: boolean;
  verdict: string;
}

/**
 * Same runtime, within a stated tolerance.
 *
 * Identical inputs give exactly 0 s of drift (not "≈0": the subtraction and the
 * rounding are both exact here), and a rebuild shifted by a second reports 1 s.
 */
export function compareRuntime(
  referenceSeconds: number,
  rebuildSeconds: number,
  toleranceSeconds = DEFAULT_RUNTIME_TOLERANCE_SECONDS,
): RuntimeComparison {
  const reference = round(referenceSeconds);
  const rebuild = round(rebuildSeconds);
  const drift = round(rebuild - reference);
  const absolute = round(Math.abs(drift));
  const within = absolute <= toleranceSeconds + 1e-9;
  return {
    referenceSeconds: reference,
    rebuildSeconds: rebuild,
    driftSeconds: drift,
    absoluteDriftSeconds: absolute,
    toleranceSeconds,
    withinTolerance: within,
    verdict: within
      ? `runtime matches: ${reference}s vs ${rebuild}s (drift ${drift}s, tolerance ${toleranceSeconds}s)`
      : `runtime DRIFTS: ${reference}s vs ${rebuild}s (drift ${drift}s, tolerance ${toleranceSeconds}s)`,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Beats
// ────────────────────────────────────────────────────────────────────────────

export interface BeatComparison {
  referenceBeats: number;
  rebuildBeats: number;
  equal: boolean;
  /** Rebuild minus reference. */
  difference: number;
  verdict: string;
}

/**
 * Same beat count.
 *
 * `referenceBeats` is the number of onsets the ANALYSIS measured and
 * `rebuildBeats` the number of spoken beats in the emitted beats.json, so a
 * measured line that was quietly dropped shows up here as a difference rather than
 * as a shorter film nobody can explain.
 */
export function compareBeats(referenceBeats: number, rebuildBeats: number): BeatComparison {
  const difference = rebuildBeats - referenceBeats;
  return {
    referenceBeats,
    rebuildBeats,
    equal: difference === 0,
    difference,
    verdict:
      difference === 0
        ? `beat count matches: ${referenceBeats}`
        : `beat count DIFFERS: reference ${referenceBeats}, rebuild ${rebuildBeats} (${difference > 0 ? '+' : ''}${difference})`,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Frames
// ────────────────────────────────────────────────────────────────────────────

export interface FramePair {
  /** Where to look, in the REFERENCE's clock. */
  at: number;
  /** The same moment in the rebuild. Equal to `at` unless a shift is applied. */
  rebuildAt: number;
  label: string;
}

/**
 * The timecodes to hold up against each other.
 *
 * Spread evenly over the SHORTER of the two runtimes, because a frame the longer
 * film has and the shorter one does not is already covered by the runtime verdict —
 * pretending to compare it would be theatre. `shiftSeconds` exists so a rebuild that
 * is known to start late can be compared at its own offset, and the shift is printed
 * on the contact sheet rather than hidden.
 */
export function framePairs(
  referenceSeconds: number,
  rebuildSeconds: number,
  count = 6,
  shiftSeconds = 0,
): FramePair[] {
  const usable = Math.max(0, Math.min(referenceSeconds, rebuildSeconds - shiftSeconds));
  const pairs: FramePair[] = [];
  const wanted = Math.max(1, Math.floor(count));
  for (let i = 0; i < wanted; i++) {
    // Even spacing with a small margin at each end: frame 0 of a HyperFrames render
    // is the lead-in plate, and the last frame is a held card.
    const at = round(0.2 + ((usable - 0.4) * i) / Math.max(1, wanted - 1), 2);
    pairs.push({ at, rebuildAt: round(at + shiftSeconds, 2), label: `${at.toFixed(2)}s` });
  }
  return pairs;
}

export interface DifferenceScore {
  /** Mean absolute difference per channel, 0-255. */
  meanAbsolute: number;
  /** The same, as a percentage of full scale. */
  percent: number;
  /** Peak signal-to-noise ratio in dB; Infinity when the frames are identical. */
  psnrDb: number;
  identical: boolean;
}

/**
 * The numeric difference between two frames of the same size.
 *
 * `a` and `b` are raw `rgb24` — the same layout `analyse.ts` samples with — so this
 * needs no image decoder and no dependency. A size mismatch is an error, not a
 * silently-clipped comparison.
 */
export function meanAbsoluteDifference(a: Uint8Array, b: Uint8Array): DifferenceScore {
  if (a.length !== b.length) {
    throw new Error(`compare: frames differ in size (${a.length} vs ${b.length} bytes) — they are not comparable`);
  }
  if (a.length === 0) return { meanAbsolute: 0, percent: 0, psnrDb: Number.POSITIVE_INFINITY, identical: true };

  let sum = 0;
  let squared = 0;
  for (let i = 0; i < a.length; i++) {
    const delta = a[i] - b[i];
    sum += Math.abs(delta);
    squared += delta * delta;
  }
  const mean = sum / a.length;
  const mse = squared / a.length;
  return {
    meanAbsolute: round(mean, 3),
    percent: round((100 * mean) / 255, 2),
    psnrDb: mse === 0 ? Number.POSITIVE_INFINITY : round(10 * Math.log10((255 * 255) / mse), 2),
    identical: sum === 0,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// The contact sheet, as an ffmpeg command
// ────────────────────────────────────────────────────────────────────────────

/** Escape a string for a `drawtext` value inside a filtergraph. */
export function escapeDrawText(text: string): string {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

export interface ContactSheetOptions {
  /** Pair images, in row order. Each becomes one row: reference left, rebuild right. */
  pairs: { reference: string; rebuild: string; label: string }[];
  /** Output PNG. */
  out: string;
  /** Cell size in px. The sheet is `2 * width` by `pairs.length * height`. */
  width: number;
  height: number;
  /** A font file so each cell is labelled. Omitted: no labels, and the manifest is the index. */
  fontFile?: string;
  fontSize?: number;
}

/**
 * The filtergraph for one contact sheet.
 *
 * Split out from the command string so a caller that runs ffmpeg with an ARGUMENT
 * ARRAY (no shell, no quoting) can use exactly the same graph. Row order is the
 * caller's order: reference on the LEFT of every row, rebuild on the RIGHT, and each
 * cell labelled. `hstack` needs equal heights and `vstack` equal widths, which is why
 * every cell is scaled to the same box first.
 */
export function contactSheetFilter(options: ContactSheetOptions): string {
  const { pairs, width, height, fontFile } = options;
  if (!pairs.length) throw new Error('compare: a contact sheet needs at least one pair');
  const fontSize = options.fontSize ?? Math.max(12, Math.round(height * 0.05));
  const pixelFormat = 'format=rgb24';

  const filters: string[] = [];
  const rows: string[] = [];

  pairs.forEach((pair, row) => {
    for (const [side, pairIndex] of [
      ['reference', 0],
      ['rebuild', 1],
    ] as const) {
      const index = row * 2 + pairIndex;
      const label = `${pair.label} ${side === 'reference' ? 'REF' : 'REBUILD'}`;
      const draw = fontFile
        ? `,drawtext=fontfile='${fontFile}':text='${escapeDrawText(label)}':x=8:y=6:fontsize=${fontSize}:` +
          'fontcolor=white:box=1:boxcolor=black@0.62:boxborderw=6'
        : '';
      filters.push(`[${index}:v]scale=${width}:${height},setsar=1,${pixelFormat}${draw}[c${index}]`);
    }
    const left = row * 2;
    filters.push(`[c${left}][c${left + 1}]hstack=inputs=2[row${row}]`);
    rows.push(`[row${row}]`);
  });

  filters.push(`${rows.join('')}vstack=inputs=${pairs.length}[sheet]`);
  return filters.join(';');
}

/** `contactSheetFilter` as an ffmpeg argument list (no shell involved). */
export function contactSheetArgs(options: ContactSheetOptions): string[] {
  const args: string[] = [];
  for (const pair of options.pairs) args.push('-i', pair.reference, '-i', pair.rebuild);
  args.push('-filter_complex', contactSheetFilter(options), '-map', '[sheet]', '-frames:v', '1', options.out);
  return ['-y', '-v', 'error', ...args];
}

/**
 * One ffmpeg invocation that stacks every pair into a contact sheet.
 *
 * The same graph as `contactSheetFilter`, as a shell string, for a caller that only
 * has a shell.
 */
export function contactSheetCommand(options: ContactSheetOptions): string {
  const inputs = options.pairs.flatMap((pair) => [`-i "${pair.reference}"`, `-i "${pair.rebuild}"`]);
  return (
    `ffmpeg -y -v error ${inputs.join(' ')} -filter_complex "${contactSheetFilter(options)}" ` +
    `-map "[sheet]" -frames:v 1 "${options.out}"`
  );
}

/** One pair as its own side-by-side PNG (what a human actually opens first). */
export function pairImageCommand(args: {
  reference: string;
  rebuild: string;
  out: string;
  width: number;
  height: number;
  fontFile?: string;
  fontSize?: number;
  label?: string;
}): string {
  return contactSheetCommand({
    pairs: [{ reference: args.reference, rebuild: args.rebuild, label: args.label ?? '' }],
    out: args.out,
    width: args.width,
    height: args.height,
    ...(args.fontFile ? { fontFile: args.fontFile } : {}),
    ...(args.fontSize ? { fontSize: args.fontSize } : {}),
  });
}

/** The frames the comparison pulls, as `ffmpeg -ss` extractions. */
export function frameExtractCommand(file: string, at: number, out: string): string {
  return `ffmpeg -y -v error -ss ${round(at, 3)} -i "${file}" -frames:v 1 "${out}"`;
}

/** A one-line summary of a whole comparison, for the log and the report. */
export function describeComparison(
  runtime: RuntimeComparison,
  beats: BeatComparison,
  differences: readonly DifferenceScore[],
): string {
  const mean = differences.length
    ? round(differences.reduce((sum, entry) => sum + entry.percent, 0) / differences.length, 2)
    : 0;
  return `${runtime.verdict} | ${beats.verdict} | frames differ by ${mean}% on average over ${differences.length} pair(s)`;
}
