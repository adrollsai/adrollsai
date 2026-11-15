/**
 * spec.ts — the measured analysis, written as a SPEC.md in the house style.
 *
 * The house SPEC (`gnr-homes-tricity/SPEC.md`) is the contract a HyperFrames build
 * is held to: GOAL / OUTPUT / TIME / LOOK / OBJECTS / MOTION / SHOTS / BANNED / QA
 * frames. A reverse-engineered film needs the same contract, filled from
 * MEASUREMENT instead of from a client brief — and that changes what a promise
 * looks like:
 *
 *   - Numbers must come from the analysis, never from imagination. `specFigures`
 *     and `auditSpec` exist so that claim is CHECKED: every figure printed here is
 *     pulled from a field of `ReverseAnalysis`, and `auditSpec` re-reads the finished
 *     markdown and fails if a figure is not a rounding of something the measurement
 *     produced. `scripts/verify-reverse.ts` runs it, and also proves it catches a
 *     planted number.
 *   - Where the analysis cannot know — the words on screen, the typeface, the brand
 *     colour, the tempo of the music, the phone number — this file writes
 *     `UNKNOWN — needs a human`. It never guesses. A guessed brand colour is the
 *     one error in a rebuild that nobody catches until the client does.
 *
 * PURE: a function of the analysis (plus a few naming options) and nothing else.
 */

import { roundTo } from '../video/beats';
import type { ReverseAnalysis, Swatch } from './analyse';

/** The phrase this file uses everywhere it cannot know something. Never rewritten. */
export const UNKNOWN = 'UNKNOWN — needs a human';

export interface SpecOptions {
  /** Defaults to the reference's file name without its extension. */
  title?: string;
  /** A human-supplied goal for the rebuild. Omitted: the spec says it is unknown. */
  goal?: string;
  /** A human-supplied brand name, 3-D. Omitted: `UNKNOWN — needs a human`. */
  brandName?: string;
  /** Extra lines to append to BANNED (a human's craft notes). Never measured. */
  extraBans?: readonly string[];
}

const num = (value: number, dp = 2): string => String(roundTo(value, dp));

/** `3.60` — a timecode, always two decimals so a column of them lines up. */
const time = (value: number): string => roundTo(value, 2).toFixed(2);

/** `#0A0E12 28.4%` */
function swatchText(swatch: Swatch): string {
  return `${swatch.hex} ${num(swatch.sharePercent, 1)}%`;
}

function swatchList(swatches: readonly Swatch[]): string {
  return swatches.length ? swatches.map(swatchText).join(', ') : UNKNOWN;
}

/** Word-wrap prose to the house width, with a hanging indent for bullets. */
function wrap(text: string, width = 100, prefix = '', indent = ''): string {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = prefix;
  let first = true;
  for (const word of words) {
    const candidate = first ? `${line}${word}` : `${line} ${word}`;
    if (candidate.length > width && !first) {
      lines.push(line);
      line = `${indent}${word}`;
      continue;
    }
    line = candidate;
    first = false;
  }
  lines.push(line);
  return lines.join('\n');
}

/**
 * The SPEC.md for one analysis.
 *
 * Every figure in the output is read off `analysis`; see `auditSpec`.
 */
export function emitSpec(analysis: ReverseAnalysis, options: SpecOptions = {}): string {
  const { facts, film, vo, alignment, shots } = analysis;
  const title = options.title ?? facts.basename.replace(/\.[^.]+$/, '');
  const out: string[] = [];

  out.push(`# SPEC — ${title} · reverse-engineered reference (${facts.aspect})`);
  out.push('');
  out.push(
    wrap(
      options.goal ??
        `Rebuild ${facts.basename} (${num(facts.durationSeconds, 2)} s, ${facts.width} × ${facts.height}) as an ` +
          `editable HyperFrames project with the same runtime and the same ${film.shotCount}-shot grid. The message ` +
          `of the film is ${UNKNOWN}: this analysis measured ${film.shotCount} shots, ` +
          `${film.textBoxCount} type-shaped region(s) and ${vo.spans.length} voice block(s), and it cannot read a ` +
          'word of any of them.',
      100,
      'GOAL: ',
      '      ',
    ),
  );
  out.push('');
  out.push(
    wrap(
      `HyperFrames, ${facts.width} × ${facts.height} (${facts.aspect}), ${num(facts.fps, 3)} fps, ` +
        `${num(facts.durationSeconds, 2)} s = ${film.frameCount} frames.`,
      100,
      'OUTPUT: ',
      '        ',
    ),
  );
  out.push('');
  out.push(
    wrap(
      `${num(facts.durationSeconds, 2)} s across ${film.shotCount} shots (${film.cutCount} cuts, ` +
        `${num(film.cutsPerMinute, 1)} cuts per minute); the shortest shot is ` +
        `${num(film.shortestShotSeconds, 2)} s and the longest ${num(film.longestShotSeconds, 2)} s. Shot ` +
        'boundaries are measured scene changes, so the grid is the film\'s own. The musical tempo is ' +
        `${UNKNOWN}: a BPM cannot be read out of a container, and this analysis does not guess one.`,
      100,
      'TIME: ',
      '      ',
    ),
  );
  out.push('');

  // ── LOOK
  out.push('LOOK');
  out.push(
    `- Film palette, measured over ${film.shotCount * analysis.samplesPerShot} sampled frames: ` +
      `${swatchList(film.palette)}.`,
  );
  out.push(
    `- Mean luma ${num(film.meanLuma, 1)} (full scale): the film sits where that figure says it sits. A grade ` +
      'brighter or darker than that is a departure from the reference, not a variant of it.',
  );
  out.push(
    `- Type placement WAS measured and type copy was NOT: ${film.typeShotCount} of ${film.shotCount} shots carry ` +
      `${film.textBoxCount} candidate type box(es), mean ${film.meanTypeWidth} × ${film.meanTypeHeight} px, covering ` +
      `${num(film.typeCoveragePercent, 2)}% of a frame's area. Those boxes are edge-and-brightness regions, ` +
      'measured, not read — there is no OCR in this pipeline. The words are ' +
      `${UNKNOWN}.`,
  );
  if (film.textBoxCount > 0) {
    out.push(
      `- Safe area, measured: candidate type sits between y = ${film.typeTopPx} px and y = ${film.typeBottomPx} px, ` +
        `x = ${film.typeLeftPx} px to ${film.typeRightPx} px. Hold that band and nothing the reference reads will ` +
        'collide with a platform edge.',
    );
  } else {
    out.push(`- Safe area: ${UNKNOWN} — no type-shaped region was found in any sampled frame.`);
  }
  out.push(`- Typeface, weight, brand colour, accent colour: ${UNKNOWN}.`);
  out.push(
    `- Ground: ${facts.basename} is ${facts.videoCodec} at ${facts.width} × ${facts.height}. Every shot's own ` +
      'palette is listed under SHOTS; there is no invented "house look" in this document.',
  );
  out.push('');

  // ── OBJECTS
  out.push(
    wrap(
      `The objects on screen are ${UNKNOWN} in substance, because an object cannot be named from pixels. What WAS ` +
        `measured is where they sit: ${film.textBoxCount} candidate type region(s) across ${film.typeShotCount} ` +
        'shot(s), each listed per shot under SHOTS. Rebuild them as type blocks with the reference\'s measured ' +
        'placement and let a human supply the words.',
      100,
      'OBJECTS: ',
      '         ',
    ),
  );
  out.push('');

  // ── MOTION
  out.push('MOTION');
  out.push(
    `- Cutting rhythm: ${film.cutCount} cuts in ${num(facts.durationSeconds, 2)} s, ` +
      `${num(film.cutsPerMinute, 1)} per minute. Shot durations run ` +
      `${num(film.shortestShotSeconds, 2)}–${num(film.longestShotSeconds, 2)} s; both extremes are on the shot ` +
      'list, so an edit that runs longer or shorter than that is not a rebuild.',
  );
  if (analysis.vo.present) {
    out.push(
      `- Voice to picture: ${alignment.aligned.length} of ${vo.spans.length} measured onset(s) land within ` +
        `${num(alignment.toleranceSeconds, 2)} s of a cut. Where an onset leads its cut, the voice leads the ` +
        'picture — that is the reference\'s convention and it is reproduced, not corrected.',
    );
  } else {
    out.push(`- Voice to picture: ${UNKNOWN} — no onset could be measured, so the voice/picture relationship is unread.`);
  }
  out.push(
    '- Enter and exit tweens, easing, camera moves inside a shot: ' +
      `${UNKNOWN} — measured as an average motion over a shot, not as a curve. Match them by eye against the ` +
      'contact sheet, not by guessing a cubic-bezier.',
  );
  out.push('');

  // ── SHOTS
  out.push(`SHOTS (measured; ${analysis.sceneThreshold} scene threshold, ${analysis.minShotSeconds} s minimum shot)`);
  shots.forEach((shot) => {
    const parts: string[] = [];
    parts.push(
      `${shot.index}. ${time(shot.start)}–${time(shot.end)} (${num(shot.dur, 3)} s) — palette ${swatchList(shot.palette)}; ` +
        `mean luma ${num(shot.meanLuma, 1)}.`,
    );
    if (shot.textBoxes.length) {
      for (const box of shot.textBoxes) {
        parts.push(
          `type box x ${box.x}–${box.right} px, y ${box.y}–${box.bottom} px ` +
            `(${num(box.areaPercent, 2)}% of frame, edge density ${num(box.edgeDensity, 4)}, brightness ` +
            `${num(box.brightness, 1)}) — placement measured, words ${UNKNOWN}.`,
        );
      }
    } else {
      parts.push('no candidate type region in the sampled frame.');
    }
    const onsets = vo.spans.filter((span) => {
      const aligned = alignment.aligned.find((entry) => entry.index === span.index);
      return aligned ? aligned.shotIndex === shot.index : false;
    });
    for (const span of onsets) {
      const aligned = alignment.aligned.find((entry) => entry.index === span.index);
      if (!aligned) continue;
      parts.push(
        `voice onset ${span.index} at ${time(span.start)} s (${num(span.dur, 3)} s long), ` +
          `${num(aligned.deltaSeconds, 3)} s from this cut.`,
      );
    }
    out.push(wrap(parts.join(' '), 100, '', '   ').replace(/\n/g, '\n   '));
  });
  out.push('');

  // ── VOICE
  out.push('VOICE (measured, not transcribed)');
  if (vo.present) {
    out.push(
      `- ${vo.spans.length} speech block(s) measured with silencedetect at a ${vo.thresholdDb} dB noise floor, ` +
        `${num(vo.totalSpeechSeconds, 3)} s of speech = ${num(vo.speechSharePercent, 1)}% of the runtime.`,
    );
    out.push(
      `- The floor was CHOSEN, not assumed: the ladder below is every one that was tried, and the rung whose blocks ` +
        'most often start on a cut won. A lower floor lumps a music bed into one enormous block; a higher one cuts ' +
        'a voice into fragments.',
    );
    for (const rung of vo.ladder) {
      out.push(
        `  - ${rung.db} dB: ${rung.blocks} block(s), ${num(rung.speechSeconds, 3)} s of speech, ` +
          `${rung.alignedBlocks} starting on a cut, median block ${num(rung.medianBlockSeconds, 3)} s, ` +
          `${rung.silenceCount} silence(s).`,
      );
    }
    out.push(
      `- Aligned to cuts within ${num(alignment.toleranceSeconds, 2)} s: ${alignment.aligned.length} of ` +
        `${vo.spans.length}.`,
    );
    if (alignment.unaligned.length) {
      out.push(
        `- Reported, NOT snapped: ${alignment.unaligned.length} onset(s) sit further than ` +
          `${num(alignment.toleranceSeconds, 2)} s from every cut — ` +
          alignment.unaligned
            .map((onset) => `onset ${onset.index} at ${time(onset.start)} s (${num(onset.deltaSeconds, 3)} s)`)
            .join(', ') +
          '. They are voice that was filmed; the rebuild places them in the shot that contains them and says so.',
      );
    }
  } else {
    out.push(`- VO section ABSENT. ${vo.reason}.`);
    out.push(`- The spoken words: ${UNKNOWN}.`);
  }
  out.push('');

  // ── NOTES
  if (analysis.notes.length) {
    out.push('ANALYSIS NOTES');
    for (const note of analysis.notes) out.push(wrap(note, 100, '- ', '  '));
    out.push('');
  }

  // ── BANNED
  out.push('BANNED');
  for (const ban of [
    'No figure in this document may be re-typed: every one came from the analysis, and a changed number is a ' +
      'different film.',
    `No invented copy, brand, price, phone number or claim. The on-screen words are ${UNKNOWN}, and placeholder ` +
      'text is a placeholder until a human replaces it.',
    'No black void with small centred type; no glow, bloom, neon, particles; no purple/blue mesh gradients or glass ' +
      'cards; no cream paper + serif + "01/02" labels.',
    'No re-timed shots: the shot list tiles the runtime exactly, and a shot that starts late leaves a black gap ' +
      'because scenes do not overlap.',
    ...(options.extraBans ?? []),
  ]) {
    out.push(wrap(ban, 100, '- ', '  '));
  }
  out.push('');

  // ── QA frames
  out.push('QA frames to look at');
  for (const point of film.inspectionPoints) {
    out.push(`- ${time(point.at)} ${point.why}.`);
  }
  out.push('');

  return `${out.join('\n')}`;
}

// ────────────────────────────────────────────────────────────────────────────
// The audit: no invented figure
// ────────────────────────────────────────────────────────────────────────────

/**
 * Every figure in a SPEC.md, with colours and ids removed first.
 *
 * `#0B0A08` is a colour and `sh07` is a shot id; both contain digits and neither is
 * a measured figure. Everything else that looks like a number is one, and has to be
 * accounted for by the analysis.
 */
export function specFigures(specText: string): number[] {
  const stripped = String(specText)
    .replace(/#[0-9A-Fa-f]{6}\b/g, ' ')
    .replace(/\b(?:sh\d{2}|s\d{1,2}|p\d{2})\b/g, ' ');
  const out: number[] = [];
  for (const match of stripped.matchAll(/-?\d+(?:\.\d+)?/g)) {
    const value = Number(match[0]);
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
}

/**
 * Every finite number in the analysis object — INCLUDING the numbers inside the
 * prose the analysis carries.
 *
 * The analysis's own `notes` and `vo.reason` are printed verbatim in the SPEC, so a
 * figure inside one of them is a figure in the document and has to be accounted for
 * here like any other.
 */
export function analysisNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) out.push(value);
    return out;
  }
  if (typeof value === 'string') {
    for (const figure of specFigures(value)) out.push(figure);
    return out;
  }
  if (Array.isArray(value)) {
    for (const entry of value) analysisNumbers(entry, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) analysisNumbers(entry, out);
  }
  return out;
}

/** How far a printed figure may sit from the measurement it came from. */
export function figureTolerance(figure: number): number {
  // A figure printed with decimals must match its measured value to that precision;
  // an integer figure may be a whole-unit rounding of a measured one (frame counts,
  // pixel counts, shot indices).
  const text = String(figure);
  const dot = text.indexOf('.');
  const decimals = dot === -1 ? 0 : text.length - dot - 1;
  if (decimals === 0) return 0.5001;
  return 0.5 * 10 ** -decimals + 1e-6;
}

export interface SpecAudit {
  ok: boolean;
  /** Figures in the spec that no measured number can account for. */
  invented: number[];
  figures: number;
}

/**
 * Prove the SPEC contains no invented figure.
 *
 * Empty `invented` is the claim: every number in the document is a rounding of a
 * number that the measurement produced.
 */
export function auditSpec(specText: string, analysis: ReverseAnalysis): SpecAudit {
  const measured = analysisNumbers(analysis);
  const figures = specFigures(specText);
  const invented = figures.filter((figure) => {
    const tolerance = figureTolerance(figure);
    return !measured.some((candidate) => Math.abs(candidate - figure) <= tolerance);
  });
  return { ok: invented.length === 0, invented, figures: figures.length };
}
