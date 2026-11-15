/**
 * Proves the `reverse` skill's contract WITHOUT a network, an ffmpeg binary or a render.
 *
 * The skill's whole claim is that it MEASURES a reference film and then hands that
 * measurement to the `video` skill — it never invents a word, a number or a beat. So
 * the gate here is about honesty, not about pixels looking nice:
 *
 *  - the parsers that read ffprobe / scene-detect / silencedetect output are driven
 *    with REAL log shapes and must reject a container that reports no duration;
 *  - the shot list TILES the runtime (no black gap, no double-played plate) and a
 *    splice-length boundary is dropped AND reported rather than silently kept;
 *  - an onset that does not land on a cut is REPORTED as unaligned, never snapped;
 *  - the SPEC cannot print a figure the analysis did not measure (`auditSpec`), and a
 *    figure pasted into it is caught;
 *  - the `beats.json` the rebuild produces is accepted by the VIDEO SKILL's own
 *    `parseBeats`, round-trips through its serialised text, and keeps `s0` at exactly
 *    0.5 s so trap 1 (a scene on screen at t = 0 never reveals its overlays) holds;
 *  - the emitted project inherits the video skill's traps: a reused plate is COPIED,
 *    nothing carries `data-media-start`, and the mastering pass is present;
 *  - the same measurement produces byte-identical output twice, so an R2 key means
 *    something;
 *  - a reverse buys NO media model: `estimateReverseCredits().media === 0`.
 *
 * The one thing this cannot prove is that a rebuild LOOKS like the reference — that
 * needs a render and a human reading a contact sheet, and `compare.ts` builds the
 * sheet rather than asserting the answer.
 *
 *   npm run verify:reverse-skill
 */
import {
  alignOnsets,
  analyseVideo,
  aspectOf,
  dominantColours,
  parseProbeJson,
  parseSceneDetect,
  sampleSize,
  shotsFromChanges,
  silenceFilter,
  speechSpans,
  textRegions,
  DEFAULT_ALIGN_TOLERANCE_SECONDS,
  MIN_ONSETS,
  SILENCE_THRESHOLD_LADDER,
  type AnalysisTools,
  type ReverseAnalysis,
} from '../lib/agent/tools/skills/reverse/analyse';
import { UNKNOWN, auditSpec, emitSpec  } from '../lib/agent/tools/skills/reverse/spec';
import { rebuildFromAnalysis, PLACEHOLDER_VO } from '../lib/agent/tools/skills/reverse/rebuild';
import {
  DEFAULT_RUNTIME_TOLERANCE_SECONDS,
  compareBeats,
  compareRuntime,
  contactSheetArgs,
  contactSheetFilter,
  escapeDrawText,
  frameExtractCommand,
  framePairs,
  meanAbsoluteDifference,
} from '../lib/agent/tools/skills/reverse/compare';
import {
  ARTEFACT_ROOT,
  SKILL_NAME,
  artefactKeysFor,
  estimateReverseCredits,
  openQuestions,
  reverseFiles,
  reverseSkill,
  type ReverseResult,
} from '../lib/agent/tools/skills/reverse';
import { MAX_LINE_WORDS, MIN_TARGET_SECONDS, parseBeats, roundTo } from '../lib/agent/tools/skills/video/beats';
import { scenesSelfConsistent } from '../lib/agent/tools/skills/video/timing';
import { RENDER_CREDITS } from '../lib/agent/sandbox/pipeline';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}

function throws(fn: () => unknown): { threw: boolean; message: string } {
  try {
    fn();
    return { threw: false, message: '' };
  } catch (error: any) {
    return { threw: true, message: String(error?.message ?? error) };
  }
}

const near = (a: number, b: number, tolerance = 0.002) => Math.abs(a - b) <= tolerance;
const section = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 66 - title.length))}`);

// ────────────────────────────────────────────────────────────────────────────
// The reference fixture: a 36 s, 9:16, 30 fps film in six 6 s shots, with the
// voice starting on every cut. Six onsets, six beats, zero unaligned. It is over
// the video skill's 30 s floor on purpose, so the rebuild can match it exactly
// and the runtime verdict is a real measurement rather than a declared shortfall.
// ────────────────────────────────────────────────────────────────────────────

const DURATION = 36;
const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;
const SHOT_SECONDS = 6;
const CUTS = [6, 12, 18, 24, 30];
const SHOT_COUNT = CUTS.length + 1;
const ONSET_COUNT = SHOT_COUNT;

/** The container, exactly as `ffprobe -of json` writes it. */
function probeJsonText(): string {
  return JSON.stringify({
    streams: [
      {
        codec_type: 'video',
        codec_name: 'h264',
        width: WIDTH,
        height: HEIGHT,
        r_frame_rate: `${FPS}/1`,
        nb_frames: DURATION * FPS,
      },
      { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 },
    ],
    format: { duration: String(DURATION), size: '5242880', format_name: 'mov,mp4,m4a' },
  });
}

/** `select='gt(scene,…)',metadata=print` output: a time, then its score. */
function sceneDetectText(): string {
  const lines: string[] = [];
  const at = (time: number, score: number) => {
    lines.push(
      `[Parsed_select_2 @ 0x55d0c0f0] frame:${Math.round(time * FPS)} pts:${Math.round(time * 90000)} ` +
        `pts_time:${time.toFixed(6)}`,
    );
    lines.push(`[Parsed_metadata_3 @ 0x55d0c0f0] lavfi.scene_score=${score.toFixed(6)}`);
  };
  at(0, 0);
  CUTS.forEach((cut, index) => at(cut, 0.44 + index * 0.04));
  return lines.join('\n');
}

/** `silencedetect` output for a set of quiet spans. */
function silenceDetectText(spans: readonly (readonly [number, number])[]): string {
  return spans
    .map(
      ([start, end]) =>
        `[silencedetect @ 0x55d0c0f0] silence_start: ${start}\n` +
        `[silencedetect @ 0x55d0c0f0] silence_end: ${end} | silence_duration: ${roundTo(end - start, 3)}`,
    )
    .join('\n');
}

/** Quiet between the spoken lines, so every line starts exactly on a cut. */
const SILENCES_ON_CUTS: readonly (readonly [number, number])[] = [
  [1.8, 6],
  [7.6, 12],
  [13.5, 18],
  [19.4, 24],
  [25.3, 30],
  [31.2, 36],
];

/** The first line starts 0.9 s late: real voice, but it lands on no cut. */
const SILENCES_OFF_CUTS: readonly (readonly [number, number])[] = [
  [0, 0.9],
  [2.4, 6],
  [7.6, 12],
  [13.5, 18],
  [19.4, 24],
  [25.3, 30],
  [31.2, 36],
];

const SHOT_BASES: readonly (readonly [number, number, number])[] = [
  [26, 32, 44],
  [44, 26, 30],
  [22, 38, 30],
  [34, 30, 46],
  [30, 40, 24],
  [38, 24, 36],
];

/**
 * One downscaled frame as raw rgb24: a dark gradient per shot, with a bright striped
 * band where a headline would sit on shots 1 and 3.
 *
 * The band is not a picture of type — it is a patch that satisfies the documented
 * definition of a type pixel (bright AND on an edge), so `textRegions` has something
 * real to measure. Nothing in the pipeline reads a word, so nothing here writes one.
 */
function frameAt(width: number, height: number, shotIndex: number, withType: boolean): Uint8Array {
  const base = SHOT_BASES[shotIndex % SHOT_BASES.length];
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const lift = 0.7 + (0.55 * y) / Math.max(1, height - 1);
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 3;
      rgb[p] = Math.min(255, Math.round(base[0] * lift));
      rgb[p + 1] = Math.min(255, Math.round(base[1] * lift));
      rgb[p + 2] = Math.min(255, Math.round(base[2] * lift));
    }
  }
  if (!withType) return rgb;

  const x0 = Math.floor(width * 0.18);
  const x1 = Math.floor(width * 0.82);
  const y0 = Math.floor(height * 0.12);
  const y1 = Math.min(height - 1, y0 + Math.max(8, Math.floor(height * 0.07)));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = (y * width + x) * 3;
      const bright = (x - x0) % 4 < 2;
      rgb[p] = bright ? 240 : 14;
      rgb[p + 1] = bright ? 236 : 14;
      rgb[p + 2] = bright ? 228 : 16;
    }
  }
  return rgb;
}

interface FakeOptions {
  /** Which shots carry a headline band. Shots are 1-based. */
  typeShots?: readonly number[];
  /** Quiet spans for the silencedetect pass; only the quietest rung uses them. */
  silences?: readonly (readonly [number, number])[];
}

/**
 * The process seams, faked.
 *
 * `log` answers the noise LADDER the way ffmpeg would: the quietest rung separates
 * four lines, every louder rung hears the mix as one continuous block (which is what
 * a music bed under a voice really does at a higher floor), so the ladder's choice is
 * exercised rather than short-circuited.
 */
function fakeTools(options: FakeOptions = {}): AnalysisTools {
  const typeShots = options.typeShots ?? [1, 3];
  const silences = options.silences ?? SILENCES_ON_CUTS;
  return {
    async probeJson() {
      return probeJsonText();
    },
    async log(_file, filter, kind) {
      if (kind === 'video') return sceneDetectText();
      const quoted = /noise=(-?\d+(?:\.\d+)?)dB/.exec(filter);
      const db = quoted ? Number(quoted[1]) : SILENCE_THRESHOLD_LADDER[0];
      return db === SILENCE_THRESHOLD_LADDER[0]
        ? silenceDetectText(silences)
        : silenceDetectText([[0, DURATION]]);
    },
    async frameRgb(_file, at, width, height) {
      const shotIndex = Math.min(SHOT_COUNT - 1, Math.floor(at / SHOT_SECONDS));
      return frameAt(width, height, shotIndex, typeShots.includes(shotIndex + 1));
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Section 1 — the parsers, on real log shapes
// ────────────────────────────────────────────────────────────────────────────

function checkParsers() {
  section('1. Parsers read real ffmpeg / ffprobe output');

  const facts = parseProbeJson(probeJsonText(), 'reference.mp4');
  check(
    'ffprobe JSON becomes the container facts',
    facts.durationSeconds === DURATION &&
      facts.width === WIDTH &&
      facts.height === HEIGHT &&
      facts.fps === FPS &&
      facts.hasAudio &&
      facts.aspect === '9:16',
    `${facts.durationSeconds}s ${facts.width}x${facts.height} ${facts.fps}fps ${facts.aspect} ${facts.videoCodec}`,
  );
  check(
    'the frame count is derived when the container does not count frames',
    facts.frameCount === DURATION * FPS,
    `${facts.frameCount} frames`,
  );

  const missing = throws(() =>
    parseProbeJson(
      JSON.stringify({ streams: [{ codec_type: 'video', width: 1080, height: 1920, r_frame_rate: '30/1' }], format: {} }),
      'broken.mp4',
    ),
  );
  check(
    'a container with no duration throws instead of inventing one',
    missing.threw && /no usable duration/i.test(missing.message),
    missing.threw ? missing.message.slice(0, 78) : 'did not throw',
  );
  const noVideo = throws(() => parseProbeJson(JSON.stringify({ streams: [], format: { duration: '10' } }), 'audio-only.mp4'));
  check(
    'a file with no video stream is refused',
    noVideo.threw && /no video stream/i.test(noVideo.message),
    noVideo.threw ? noVideo.message.slice(0, 78) : 'did not throw',
  );
  const notJson = throws(() => parseProbeJson('ffprobe: No such file', 'ghost.mp4'));
  check('a non-JSON ffprobe answer is refused', notJson.threw, notJson.threw ? notJson.message.slice(0, 60) : 'did not throw');

  const changes = parseSceneDetect(sceneDetectText());
  check(
    'scene-detect log becomes cuts, in time order, with their scores',
    changes.length === CUTS.length + 1 &&
      changes[0].time === 0 &&
      changes.slice(1).every((change, index) => change.time === CUTS[index] && change.score > 0),
    changes.map((change) => `${change.time}@${change.score}`).join(' '),
  );
  const scd = parseSceneDetect('[scdet @ 0x1] lavfi.scd.time=3.25\n[scdet @ 0x1] lavfi.scd.score=0.61');
  check(
    'the other real cut format (scdet) is read too',
    scd.length === 1 && scd[0].time === 3.25 && scd[0].score === 0.61,
    scd.length ? `${scd[0].time}@${scd[0].score}` : 'nothing parsed',
  );
  check(
    'a log with no cut in it yields no cut, not a default',
    parseSceneDetect('frame=  120 fps=0.0 q=-0.0 size=N/A time=00:00:04.00 bitrate=N/A').length === 0,
    'banner-only log',
  );

  const { shots, dropped } = shotsFromChanges(changes, DURATION);
  const covered = roundTo(
    shots.reduce((sum, shot) => sum + shot.dur, 0),
    3,
  );
  check(
    'the shots TILE the runtime exactly — no gap, no overlap',
    shots.length === SHOT_COUNT && near(covered, DURATION),
    `${shots.length} shots over ${covered}s of ${DURATION}s`,
  );
  check(
    'shot ids and indices are stable and 1-based',
    shots.every((shot, index) => shot.index === index + 1 && shot.id === `sh${String(index + 1).padStart(2, '0')}`),
    shots.map((shot) => shot.id).join(' '),
  );
  check(
    'a cut at 0 and a cut at the end are dropped AND reported',
    dropped.some((entry) => /first frame/.test(entry.why)) && dropped.length >= 1,
    dropped.map((entry) => `${entry.time}s: ${entry.why}`).join('; '),
  );
  const spliced = shotsFromChanges(
    [
      { time: 4, score: 0.5 },
      { time: 4.033, score: 0.5 },
      { time: 9, score: 0.5 },
    ],
    DURATION,
  );
  check(
    'a 33 ms splice is dropped as an artefact, not kept as a shot',
    spliced.shots.length === 3 && spliced.dropped.some((entry) => /33ms|0\.033s/.test(entry.why)),
    spliced.dropped.map((entry) => entry.why).join('; '),
  );

  const spans = speechSpans(
    SILENCES_ON_CUTS.map(([start, end]) => ({ start, end })),
    DURATION,
  );
  check(
    'speech is the complement of the measured silence',
    spans.length === ONSET_COUNT &&
      spans[0].start === 0 &&
      spans.every((span, index) => index === 0 || near(span.start, CUTS[index - 1])),
    spans.map((span) => `${span.start}+${span.dur}`).join(' '),
  );
  const clicky = speechSpans([{ start: 1, end: 2 }, { start: 2.05, end: 5 }, { start: 5.1, end: 5.2 }], 6);
  check(
    'a 50 ms blip between two silences is not called a line',
    clicky.every((span) => span.dur >= 0.3),
    clicky.map((span) => `${span.dur}s`).join(' '),
  );

  const onCuts = alignOnsets(spans, shots);
  check(
    'every line that starts on a cut is aligned to it',
    onCuts.aligned.length === ONSET_COUNT && onCuts.unaligned.length === 0,
    `${onCuts.aligned.length} aligned, ${onCuts.unaligned.length} unaligned`,
  );
  const late = speechSpans(
    SILENCES_OFF_CUTS.map(([start, end]) => ({ start, end })),
    DURATION,
  );
  const lateAlignment = alignOnsets(late, shots);
  check(
    'an onset 0.9 s from every cut is REPORTED as unaligned, not snapped to one',
    lateAlignment.unaligned.length === 1 &&
      lateAlignment.unaligned[0].nearestShot === 'sh01' &&
      near(lateAlignment.unaligned[0].deltaSeconds, 0.9) &&
      new RegExp(`${DEFAULT_ALIGN_TOLERANCE_SECONDS}s`).test(lateAlignment.unaligned[0].why),
    lateAlignment.unaligned.length ? lateAlignment.unaligned[0].why.slice(0, 96) : 'nothing reported',
  );

  const sample = sampleSize(WIDTH, HEIGHT);
  const bandFrame = frameAt(sample.width, sample.height, 0, true);
  const boxes = textRegions({ width: sample.width, height: sample.height, rgb: bandFrame }, WIDTH, HEIGHT);
  check(
    'a headline band is measured as a type box, in frame coordinates',
    boxes.length === 1 &&
      boxes[0].width > 0 &&
      boxes[0].height > 0 &&
      boxes[0].y < HEIGHT * 0.3 &&
      boxes[0].width / boxes[0].height >= 1.2,
    boxes.length
      ? `x=${boxes[0].x} y=${boxes[0].y} ${boxes[0].width}x${boxes[0].height} (${boxes[0].areaPercent}% of frame)`
      : 'no box found',
  );
  check(
    'a shot with no type reports no box, rather than a guess',
    textRegions({ width: sample.width, height: sample.height, rgb: frameAt(sample.width, sample.height, 1, false) }, WIDTH, HEIGHT)
      .length === 0,
    'plain gradient frame',
  );
  const palette = dominantColours({ width: sample.width, height: sample.height, rgb: bandFrame });
  check(
    'a palette comes back in share order, as hex',
    palette.length >= 1 &&
      palette.every((swatch) => /^#[0-9A-F]{6}$/.test(swatch.hex)) &&
      palette.every((swatch, index) => index === 0 || palette[index - 1].sharePercent >= swatch.sharePercent),
    palette.map((swatch) => `${swatch.hex} ${swatch.sharePercent}%`).join(' '),
  );

  check(
    'the ladder has more than one rung to choose from',
    SILENCE_THRESHOLD_LADDER.length >= 2 && MIN_ONSETS >= 2,
    `${SILENCE_THRESHOLD_LADDER.length} rungs from ${SILENCE_THRESHOLD_LADDER.join(' to ')} dB, MIN_ONSETS ${MIN_ONSETS}`,
  );
  check(
    'silenceFilter emits the video skill\'s own filter at its default floor',
    silenceFilter().startsWith('silencedetect=noise=') && /noise=-35dB/.test(silenceFilter(-35, 0.1)),
    silenceFilter(),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Section 2 — the measurement, end to end over the fake seams
// ────────────────────────────────────────────────────────────────────────────

async function checkAnalysis(): Promise<ReverseAnalysis> {
  section('2. The measurement (analysis)');

  const analysis = await analyseVideo('reference.mp4', fakeTools());

  check(
    'the analysis is versioned and names its reference',
    analysis.version === 1 && analysis.reference.basename === 'reference.mp4',
    `v${analysis.version} ${analysis.reference.basename}`,
  );
  check(
    'the film figures are measured, not assumed',
    analysis.film.shotCount === SHOT_COUNT &&
      analysis.film.cutCount === CUTS.length &&
      analysis.film.typeShotCount === 2 &&
      analysis.film.textBoxCount === 2,
    `${analysis.film.shotCount} shots, ${analysis.film.cutCount} cuts, ${analysis.film.typeShotCount} with type`,
  );
  check(
    'the voice is measured at the rung that lands on the cuts',
    analysis.vo.present && analysis.vo.spans.length === ONSET_COUNT && analysis.vo.thresholdDb === SILENCE_THRESHOLD_LADDER[0],
    analysis.vo.present ? `${analysis.vo.spans.length} onsets at ${analysis.vo.thresholdDb} dB` : analysis.vo.reason,
  );
  check(
    'every rung of the ladder is kept, so the choice can be argued with',
    analysis.vo.ladder.length === SILENCE_THRESHOLD_LADDER.length,
    analysis.vo.ladder.map((rung) => `${rung.db}dB:${rung.blocks}b/${rung.alignedBlocks}a`).join(' '),
  );
  check(
    'the analysis says WHY that floor won',
    /noise floor/.test(analysis.vo.reason) && analysis.vo.reason.length > 40,
    analysis.vo.reason.slice(0, 104),
  );
  check(
    'inspection points are derived from the measured grid and stay inside the film',
    analysis.film.inspectionPoints.length >= SHOT_COUNT + 1 &&
      analysis.film.inspectionPoints.every((point) => point.at > 0 && point.at < DURATION),
    analysis.film.inspectionPoints.map((point) => point.at).join(', '),
  );

  const offCuts = await analyseVideo('reference.mp4', fakeTools({ silences: SILENCES_OFF_CUTS }));
  check(
    'a line that misses every cut is carried through as unaligned, with its distance',
    offCuts.alignment.unaligned.length === 1 &&
      offCuts.alignment.aligned.length === ONSET_COUNT - 1 &&
      offCuts.alignment.unaligned[0].nearestShot === 'sh01',
    `${offCuts.alignment.aligned.length} aligned, ${offCuts.alignment.unaligned.length} unaligned of ${offCuts.vo.spans.length} onsets`,
  );

  const silent = await analyseVideo('reference.mp4', fakeTools({ silences: [[0, DURATION]] }));
  check(
    'a mix with no measurable line reports the voice as ABSENT, not as one long beat',
    silent.vo.present === false && silent.vo.spans.length === 0 && /continuous/.test(silent.vo.reason),
    silent.vo.reason.slice(0, 104),
  );

  return analysis;
}

// ────────────────────────────────────────────────────────────────────────────
// Section 3 — the SPEC may print only what was measured
// ────────────────────────────────────────────────────────────────────────────

function checkSpec(analysis: ReverseAnalysis) {
  section('3. The SPEC (no invented figure)');

  const spec = emitSpec(analysis, { title: 'Reference' });
  const audit = auditSpec(spec, analysis);
  check(
    'every figure in the SPEC is a rounding of a measured one',
    audit.ok && audit.invented.length === 0,
    `${audit.figures} figures, ${audit.invented.length} invented${audit.invented.length ? ` (${audit.invented.join(', ')})` : ''}`,
  );
  const poisoned = auditSpec(`${spec}\n- the film runs 999.5 s and was cut 77 times.\n`, analysis);
  check(
    'a figure pasted into the SPEC is caught',
    !poisoned.ok && poisoned.invented.includes(999.5) && poisoned.invented.includes(77),
    poisoned.invented.join(', '),
  );
  check(
    'the SPEC carries the unknowns as questions for a human, not as guesses',
    spec.includes(UNKNOWN) && /UNKNOWN/.test(spec),
    `${(spec.match(/UNKNOWN/g) ?? []).length} unknown marker(s)`,
  );
  check(
    'the SPEC names the aspect, the runtime and the shot count it measured',
    spec.includes('9:16') && /\b36\b/.test(spec) && new RegExp(`\\b${SHOT_COUNT}\\b`).test(spec),
    `${spec.length} chars`,
  );

  const questions = openQuestions(analysis);
  check(
    'the open questions name the copy and the brand card',
    questions.length >= 3 && questions.some((q) => /copy|word/i.test(q)) && questions.some((q) => /brand/i.test(q)),
    questions.length + ' questions',
  );
  const offCutsQuestions = openQuestions({ ...analysis, vo: { ...analysis.vo, present: false } });
  check(
    'a film with no measurable voice adds the voice to the open questions',
    offCutsQuestions.some((q) => /voice/i.test(q)),
    offCutsQuestions[offCutsQuestions.length - 1].slice(0, 96),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Section 4 — the rebuild is a beats file the video skill itself accepts
// ────────────────────────────────────────────────────────────────────────────

function checkRebuild(analysis: ReverseAnalysis) {
  section('4. The rebuild (beats.json the video skill accepts)');

  const rebuild = rebuildFromAnalysis(analysis);
  const parsed = parseBeats(JSON.parse(JSON.stringify(rebuild.raw)));
  const spoken = parsed.beats.filter((beat) => beat.vo.length > 0);

  check(
    'parseBeats accepts the generated file — the video skill is the judge, not this script',
    parsed.beats.length === rebuild.beats.beats.length,
    `${parsed.beats.length} beats, aspect ${parsed.aspect}, ${parsed.fps}fps`,
  );
  check(
    'there is one spoken beat per measured onset',
    spoken.length === analysis.vo.spans.length,
    `${spoken.length} spoken of ${analysis.vo.spans.length} measured`,
  );
  check(
    'no beat carries a transcript: `vo` is the marked blank, because nothing was transcribed',
    spoken.every((beat) => beat.vo === PLACEHOLDER_VO),
    spoken[0] ? JSON.stringify(spoken[0].vo) : 'no beats',
  );
  check(
    'every on-screen line is a marked blank too, never invented copy',
    parsed.beats.every((beat) => beat.lines.every((line) => /^WORD( WORD)*$/.test(line))),
    parsed.beats[0] ? parsed.beats[0].lines.join(' | ') : 'no lines',
  );
  check(
    `every line is short enough to read (<= ${MAX_LINE_WORDS[parsed.aspect]} words at ${parsed.aspect})`,
    parsed.beats.every((beat) => beat.lines.every((line) => line.split(/\s+/).length <= MAX_LINE_WORDS[parsed.aspect])),
    parsed.beats.map((beat) => beat.lines[0]?.split(/\s+/).length ?? 0).join(','),
  );
  check(
    'there is a plate per shot and a scene per shot-group',
    parsed.plates.length === SHOT_COUNT && parsed.scenes.length >= SHOT_COUNT,
    `${parsed.plates.length} plates, ${parsed.scenes.length} scenes`,
  );
  check(
    "the plates are the reference's OWN shots — no model is asked for footage",
    parsed.plates.every((plate) => plate.source === 'asset' && Boolean(plate.key) && !plate.prompt),
    parsed.plates.map((plate) => `${plate.id}:${plate.source}`).join(' '),
  );
  check(
    'the end card is present and says UNKNOWN rather than a plausible brand',
    /UNKNOWN/.test(parsed.endCard.name) && parsed.endCard.numbers.length === 2,
    `${parsed.endCard.name} / ${parsed.endCard.tagline}`,
  );
  check(
    'the declared runtime is the reference\'s runtime',
    near(parsed.targetSeconds, DURATION, 1e-6),
    `${parsed.targetSeconds}s target`,
  );

  const timingReport = scenesSelfConsistent(rebuild.timing);
  check(
    'the clock is self-consistent: scenes tile it and no beat sits outside its scene',
    timingReport.ok,
    timingReport.ok ? `${Object.keys(rebuild.timing.scenes).length} scenes, ${rebuild.timing.total}s` : timingReport.problems.join('; '),
  );
  const lead = rebuild.timing.sceneList.s0;
  check(
    's0 is exactly the 0.5 s plate-only lead-in (trap 1: a scene at t=0 never reveals overlays)',
    Boolean(lead) && near(lead.dur, 0.5) && lead.start === 0 && !rebuild.timing.scenes.s0,
    lead ? `s0 ${lead.dur}s at ${lead.start}s; s1 starts at ${rebuild.timing.sceneList.s1?.start}s` : 'no s0',
  );
  check(
    "the scenes tile the reference's runtime with no accumulated slack",
    near(
      roundTo(
        Object.values(rebuild.timing.sceneList).reduce((sum, scene) => sum + scene.dur, 0),
        3,
      ),
      rebuild.timing.total,
    ),
    `${Object.keys(rebuild.timing.sceneList).length} scenes tile ${rebuild.timing.total}s`,
  );
  check(
    'the rebuild keeps every one of the reference\'s cuts as a beat',
    rebuild.beats.beats.filter((beat) => beat.vo.length > 0).length === analysis.vo.spans.length,
    `${rebuild.beats.beats.length} beats`,
  );

  const files = rebuild.project.files.map((file) => file.path);
  check(
    'the emitted project carries the video skill\'s full file set',
    ['beats.json', 'timing.json', 'grading.sh', 'master.sh', 'hyperframes.json'].every((path) => files.includes(path)),
    `${files.length} files`,
  );
  const grading = rebuild.project.files.find((file) => file.path === 'grading.sh')?.content ?? '';
  check(
    'a plate reused by a second scene is COPIED (trap 3: one mp4 in two scenes kills the render)',
    grading.includes('__s0.mp4'),
    (grading.match(/cp -f [^\n]*/g) ?? []).slice(0, 2).join(' | ') || 'no copy line',
  );
  check(
    'the grade is baked with ffmpeg and plates are stripped of audio',
    grading.includes('-an') && /eq=|colorbalance/.test(grading),
    'grading.sh grades and mutes',
  );
  // Trap 3 is not "no data-media-start" — it is "one source file, two different
  // media starts". The emitter copies a reused plate per scene, so every scene's
  // source is its own file; that is the invariant worth pinning.
  const mediaBySource = new Map<string, Set<string>>();
  for (const file of rebuild.project.files.filter((entry) => entry.path.startsWith('compositions/'))) {
    for (const match of file.content.matchAll(/<video[^>]*?src="([^"]*)"[^>]*?data-media-start="([^"]*)"/g)) {
      const set = mediaBySource.get(match[1]) ?? new Set<string>();
      set.add(match[2]);
      mediaBySource.set(match[1], set);
    }
  }
  check(
    'no source file backs two scenes with different media starts (trap 3: that dies ~70% in)',
    mediaBySource.size >= SHOT_COUNT &&
      [...mediaBySource.values()].every((starts) => starts.size === 1),
    `${mediaBySource.size} distinct source(s): ${[...mediaBySource.entries()]
      .filter(([, starts]) => starts.size > 1)
      .map(([src]) => src)
      .join(', ') || 'all single-use'}`,
  );
  const master = rebuild.project.files.find((file) => file.path === 'master.sh')?.content ?? '';
  check(
    'the rebuild inherits the mastering pass, so the film is loudness-deliverable',
    master.includes('loudnorm=') && master.includes('linear=true') && /exit 3/.test(master),
    master ? 'master.sh present with a measured target' : 'master.sh MISSING',
  );
  check(
    'the emitted project is deterministic: two builds of one measurement are identical',
    JSON.stringify(rebuildFromAnalysis(analysis).project.files) === JSON.stringify(rebuild.project.files),
    `${rebuild.project.files.length} files compared`,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Section 5 — the whole skill, twice, and the money
// ────────────────────────────────────────────────────────────────────────────

async function checkSkill(): Promise<ReverseResult> {
  section('5. The skill end to end, and what it costs');

  const first = await reverseSkill({ file: 'reference.mp4', title: 'Reference' }, fakeTools());
  const second = await reverseSkill({ file: 'reference.mp4', title: 'Reference' }, fakeTools());

  check(
    'the skill composes measurement, SPEC, rebuild and comparison',
    Boolean(first.analysis && first.spec && first.rebuild && first.runtime && first.beats),
    first.briefing,
  );
  check(
    'the same reference produces byte-identical beats, timing and project',
    first.beatsJson === second.beatsJson &&
      first.timingJson === second.timingJson &&
      JSON.stringify(first.project.files) === JSON.stringify(second.project.files) &&
      first.spec === second.spec,
    `beats.json ${first.beatsJson.length} bytes, ${first.project.files.length} files`,
  );
  check(
    'the runtime verdict is measured against the reference, not asserted',
    first.runtime.referenceSeconds === DURATION &&
      first.runtime.withinTolerance &&
      first.runtime.absoluteDriftSeconds <= DEFAULT_RUNTIME_TOLERANCE_SECONDS,
    first.runtime.verdict,
  );
  check(
    'the beat count matches what was measured',
    first.beats.equal && first.beats.referenceBeats === ONSET_COUNT,
    first.beats.verdict,
  );
  check(
    'the SPEC the skill ships also passes its own audit',
    first.audit.ok,
    `${first.audit.figures} figures, ${first.audit.invented.length} invented`,
  );
  check(
    'the briefing is one line a human can read',
    first.briefing.length > 40 && first.briefing.includes('9:16') && first.briefing.includes('shots'),
    first.briefing,
  );

  const credits = estimateReverseCredits();
  check(
    'a reverse buys NO media model — its only cost is the render',
    credits.media === 0 && credits.render === RENDER_CREDITS && credits.total === RENDER_CREDITS,
    `${credits.total} credits: ${credits.detail}`,
  );

  const keys = artefactKeysFor(first.analysis);
  check(
    'artefact keys are seeded, under the skill\'s own prefix',
    Object.values(keys).every((key) => key.startsWith(`${ARTEFACT_ROOT}/`)) &&
      keys.beats.endsWith('/beats.json') &&
      keys.spec.endsWith('/SPEC.md') &&
      artefactKeysFor(first.analysis).beats === keys.beats,
    keys.beats,
  );
  check(
    'the skill is addressed by a stable name',
    SKILL_NAME === 'reverse',
    SKILL_NAME,
  );

  const files = reverseFiles(first);
  const paths = files.map((file) => file.path);
  check(
    'the reviewable artefacts come first: SPEC, beats, timing, analysis',
    paths[0] === 'SPEC.md' &&
      paths[1] === 'beats.json' &&
      paths[2] === 'timing.json' &&
      paths[3] === 'analysis.json' &&
      paths.filter((path) => path === 'beats.json').length === 1,
    paths.slice(0, 4).join(', ') + ` (+${paths.length - 4})`,
  );
  check(
    'the files include the whole emitted project, not just the JSON',
    paths.includes('grading.sh') && paths.some((path) => path.startsWith('compositions/')),
    paths.filter((path) => path.startsWith('compositions/')).join(' '),
  );

  // A voice-less reference cannot become a film: the video skill's own contract
  // (parseBeats refuses an empty `beats` array; every beat carries a voice track)
  // leaves nothing to rebuild against. The skill must say that, in words a person
  // can act on, rather than emit a project that dies at render time.
  let noVoiceError = '';
  let noVoiceName = '';
  try {
    await reverseSkill({ file: 'reference.mp4', analyse: {}, rebuild: {} }, fakeTools({ silences: [[0, DURATION]] }));
  } catch (error: any) {
    noVoiceError = String(error?.message ?? error);
    noVoiceName = String(error?.name ?? '');
  }
  check(
    'a reference with no measurable voice is REFUSED with the measurement\'s own reason',
    noVoiceName === 'ReverseRebuildError' &&
      /no measurable voice line/.test(noVoiceError) &&
      /no noise floor between/.test(noVoiceError) &&
      /video skill requires at least one spoken beat/.test(noVoiceError),
    noVoiceError.slice(0, 132) || 'did not throw',
  );

  const played = await reverseSkill(
    {
      file: 'reference.mp4',
      rebuild: {
        lines: { sh01: ['SITE VISIT TODAY'], sh02: ['PRICE ON ASK'], sh03: ['CALL NOW'] },
      },
    },
    fakeTools(),
  );
  const suppliedBeats = parseBeats(JSON.parse(played.beatsJson)).beats;
  check(
    'a human-supplied line is used verbatim where it was given',
    suppliedBeats.some((beat) => beat.lines.includes('SITE VISIT TODAY')) &&
      suppliedBeats.some((beat) => beat.lines.includes('PRICE ON ASK')),
    suppliedBeats.map((beat) => beat.lines.join('/')).join(' · '),
  );

  return first;
}

// ────────────────────────────────────────────────────────────────────────────
// Section 6 — the comparison refuses to call a drift a match
// ────────────────────────────────────────────────────────────────────────────

function checkCompare() {
  section('6. The comparison (held against the reference)');

  const same = compareRuntime(24, 24);
  check(
    'an identical runtime drifts by exactly 0 s',
    same.driftSeconds === 0 && same.withinTolerance && near(same.absoluteDriftSeconds, 0, 1e-9),
    same.verdict,
  );
  const off = compareRuntime(24, 30);
  check(
    'a 6 s drift is a DRIFT, not a match',
    !off.withinTolerance && near(off.driftSeconds, 6) && /DRIFTS/.test(off.verdict),
    off.verdict,
  );
  check(
    'the drift is signed: running long is positive, running short is negative',
    compareRuntime(24, 26).driftSeconds > 0 && compareRuntime(24, 22).driftSeconds < 0,
    `${compareRuntime(24, 26).driftSeconds} / ${compareRuntime(24, 22).driftSeconds}`,
  );
  check(
    'a beat count that lost a line is reported with the difference',
    !compareBeats(4, 3).equal && compareBeats(4, 3).difference === -1 && compareBeats(4, 4).equal,
    compareBeats(4, 3).verdict,
  );

  const pairs = framePairs(24, 24, 6);
  check(
    'the frames compared are spread over the shorter runtime, never past its end',
    pairs.length === 6 && pairs[0].at === 0.2 && pairs.every((pair) => pair.at < 24) && pairs[5].at > pairs[0].at,
    pairs.map((pair) => pair.at).join(', '),
  );
  check(
    'a known offset can be declared, and it is carried on the pair',
    framePairs(24, 24, 3, 0.5).every((pair) => near(pair.rebuildAt, pair.at + 0.5)),
    `shift 0.5 s: ${framePairs(24, 24, 3, 0.5).map((pair) => pair.rebuildAt).join(', ')}`,
  );
  const identical = meanAbsoluteDifference(new Uint8Array([10, 20, 30]), new Uint8Array([10, 20, 30]));
  check(
    'identical frames score 0% different and say so',
    identical.identical && identical.meanAbsolute === 0 && identical.percent === 0,
    `psnr ${identical.psnrDb}`,
  );
  const different = meanAbsoluteDifference(new Uint8Array([0, 0, 0]), new Uint8Array([255, 255, 255]));
  check(
    'a black frame against a white one is 100% different, not "similar"',
    different.percent === 100 && different.meanAbsolute === 255,
    `${different.percent}% / psnr ${different.psnrDb} dB`,
  );
  const sizeMismatch = throws(() => meanAbsoluteDifference(new Uint8Array(6), new Uint8Array(9)));
  check(
    'frames of different sizes are refused rather than clipped into a fake score',
    sizeMismatch.threw && /not comparable/.test(sizeMismatch.message),
    sizeMismatch.message.slice(0, 76),
  );

  const sheet = {
    pairs: [
      { reference: 'ref0.png', rebuild: 'reb0.png', label: '0.20s' },
      { reference: 'ref1.png', rebuild: 'reb1.png', label: '4.00s' },
    ],
    out: 'sheet.png',
    width: 320,
    height: 570,
    fontFile: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  };
  const filter = contactSheetFilter(sheet);
  const args = contactSheetArgs(sheet);
  check(
    'the contact sheet puts the reference LEFT and the rebuild RIGHT, labelled',
    filter.includes('hstack=inputs=2') &&
      filter.includes('vstack=inputs=2') &&
      filter.includes('REF') &&
      filter.includes('REBUILD'),
    `${filter.split(';').length} filter nodes`,
  );
  check(
    'the same graph is available as an argument list, so no shell quoting is needed',
    args[0] === '-y' && args.includes('-filter_complex') && args.includes('[sheet]') && !args.includes('-nostdin'),
    `${args.length} args`,
  );
  check(
    'a label with a colon or an apostrophe is escaped for drawtext',
    escapeDrawText("it's 1:30") === "it\\'s 1\\:30",
    escapeDrawText("it's 1:30"),
  );
  check(
    'a frame is pulled at a stated timecode, not from the middle of nowhere',
    frameExtractCommand('final.mp4', 4.1234, 'f.png') === 'ffmpeg -y -v error -ss 4.123 -i "final.mp4" -frames:v 1 "f.png"',
    frameExtractCommand('final.mp4', 4.1234, 'f.png'),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Section 7 — a reference with no voice at all, and a rebuild that overruns
// ────────────────────────────────────────────────────────────────────────────

async function checkEdges() {
  section('7. Edges the honest path has to survive');

  const short = await analyseVideo('short.mp4', {
    ...fakeTools(),
    async probeJson() {
      const parsed = JSON.parse(probeJsonText());
      parsed.format.duration = '4';
      parsed.streams[0].nb_frames = 120;
      return JSON.stringify(parsed);
    },
    // Two short lines, so the VO pass clears MIN_ONSETS and the rebuild has something
    // to hold: one onset on the first frame, one 1.4 s into the only shot.
    async log(_file, _filter, kind) {
      return kind === 'video' ? sceneDetectText() : silenceDetectText([[1.2, 2.6]]);
    },
  });
  check(
    'a 4 s reference is measured without inventing shots or beats',
    short.facts.durationSeconds === 4 && short.film.shotCount === 1 && short.vo.spans.length === 2,
    `${short.film.shotCount} shot(s), ${short.vo.spans.length} onset(s)`,
  );
  const shortRebuild = rebuildFromAnalysis(short);
  check(
    "a reference under the video skill's floor still produces a valid beats file, with the shortfall declared",
    parseBeats(JSON.parse(JSON.stringify(shortRebuild.raw))).targetSeconds >= MIN_TARGET_SECONDS &&
      shortRebuild.notes.some((note) => /floor/i.test(note)),
    shortRebuild.notes.find((note) => /floor/i.test(note))?.slice(0, 110) ?? `${shortRebuild.timing.total}s`,
  );

  const noAudio = await analyseVideo('mute.mp4', {
    ...fakeTools(),
    async probeJson() {
      const parsed = JSON.parse(probeJsonText());
      parsed.streams = [parsed.streams[0]];
      return JSON.stringify(parsed);
    },
  });
  check(
    'a film with no audio stream reports the VO section as absent, with the reason',
    noAudio.vo.present === false && /no audio stream/.test(noAudio.vo.reason),
    noAudio.vo.reason.slice(0, 100),
  );
  let silentRefusal = '';
  let silentRefusalName = '';
  try {
    rebuildFromAnalysis(noAudio);
  } catch (error: any) {
    silentRefusal = String(error?.message ?? error);
    silentRefusalName = String(error?.name ?? '');
  }
  check(
    'a mute reference is refused by name, with the reason the analysis found',
    silentRefusalName === 'ReverseRebuildError' && /no audio stream/.test(silentRefusal),
    silentRefusal.slice(0, 120) || 'did not throw',
  );

  let truncatedError = '';
  try {
    await analyseVideo('truncated.mp4', {
      ...fakeTools(),
      async frameRgb() {
        return new Uint8Array(12);
      },
    });
  } catch (error: any) {
    truncatedError = String(error?.message ?? error);
  }
  check(
    'a truncated frame is refused with the arithmetic that failed',
    /expected/.test(truncatedError) && /frame extraction is not working/.test(truncatedError),
    truncatedError.slice(0, 110) || 'did not throw',
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Run
// ────────────────────────────────────────────────────────────────────────────

// ════════════════════════════════════════════════════════════════════════════
// 8. A fast-cut reference: many brief onsets, none long enough to carry a word
// ════════════════════════════════════════════════════════════════════════════

async function checkFastCut() {
  section('8. A fast-cut reference still rebuilds, readably');

  // Six shots, each with ONE brief spoken line of 0.45-0.95 s. This is the shape of the
  // owner's real reference (a 61 s course promo whose 44 onsets were mostly under a
  // second): there is nothing to merge within a shot, so the only way to keep every line
  // readable is to let the beat borrow the silence that follows it.
  const SHORT_SILENCES: readonly (readonly [number, number])[] = [
    [0.45, 6],
    [6.95, 12],
    [13, 18],
    [19, 24],
    [25, 30],
    [31, 36],
  ];

  const shortAnalysis = await analyseVideo('fast.mp4', fakeTools({ silences: SHORT_SILENCES }));
  check(
    'the brief lines are measured, not lost',
    shortAnalysis.vo.present && shortAnalysis.vo.spans.length === 6,
    `${shortAnalysis.vo.spans.length} onset(s), longest ${Math.max(
      ...shortAnalysis.vo.spans.map((span) => span.dur),
    )}s`,
  );

  const rebuilt = rebuildFromAnalysis(shortAnalysis);
  check(
    'a fast-cut reference REBUILDS instead of being refused',
    Boolean(rebuilt.project) && rebuilt.project.files.length > 0,
    `${rebuilt.project.files.length} files, ${rebuilt.beats.beats.length} beat(s) from ${shortAnalysis.vo.spans.length} onsets`,
  );
  check(
    'every drawn line is within the word limit for its aspect',
    rebuilt.beats.beats.every((beat) =>
      beat.lines.every((line) => {
        const words = line.split(/\s+/).filter(Boolean).length;
        return words >= 1 && words <= MAX_LINE_WORDS[rebuilt.beats.aspect];
      }),
    ),
    rebuilt.beats.beats.map((beat) => beat.lines[0]).join(' | '),
  );
  check(
    'the rebuild still matches the reference runtime',
    near(rebuilt.timing.total, shortAnalysis.facts.durationSeconds, 0.31),
    `${rebuilt.timing.total}s vs ${shortAnalysis.facts.durationSeconds}s`,
  );
  check(
    'the grouping is explained rather than silent',
    rebuilt.notes.some((note) => /share one beat|shorter than the|too short to hold|borrows/i.test(note)),
    rebuilt.notes.find((note) => /beat/i.test(note))?.slice(0, 110) ?? 'no grouping note',
  );

  // The bug this covers: `voiceSlices` assumed beats mapped 1:1 to onsets, so a merged
  // beat lost its voice and the film failed with "no measured onset" on a beat that
  // plainly has one.
  const reread = rebuildFromAnalysis(shortAnalysis);
  check(
    'the beat-to-voice mapping survives a rebuild that grouped the voice',
    reread.beats.beats.length === rebuilt.beats.beats.length &&
      JSON.stringify(reread.project.files) === JSON.stringify(rebuilt.project.files),
    `${reread.beats.beats.length} beats, identical project`,
  );
  check(
    'the emitter accepted it, which it only does for readable lines',
    Boolean(rebuilt.project.files.find((file) => file.path === 'grading.sh')),
    // emitProject runs INSIDE rebuildFromAnalysis and is what refused the unreadable
    // version, so reaching here with a project means every line passed the real check.
    'a beat cannot be unreadable and still have a project',
  );

  // The end card cannot also carry lines. That is a real, measured limitation, so the
  // rebuild must SAY it rather than quietly losing a line.
  check(
    'a line the end card will not draw is reported, with the reference\'s measured tail',
    (() => {
      const endcard = rebuilt.beats.scenes.find((scene) => scene.kind === 'endcard');
      if (!endcard || endcard.beats.length === 0) {
        // This fixture's last shot has voice, so the card scene should carry it.
        return rebuilt.notes.some((note) => /end card draws its own blocks/.test(note));
      }
      const note = rebuilt.notes.find((entry) => /end card draws its own blocks/.test(entry));
      return Boolean(note) && /s of picture after its last spoken line/.test(String(note));
    })(),
    rebuilt.notes.find((note) => /end card/.test(note))?.slice(0, 120) ?? 'no note',
  );
  check(
    'the tail is measured, not assumed',
    (() => {
      // The fixture's last shot is 36 s long and its last line is brief, so there IS a
      // tail; the note must quote a real number rather than a fixed string.
      const note = rebuilt.notes.find((entry) => /s of picture after its last spoken line/.test(entry));
      const tail = note ? Number(/has ([\d.]+)s of picture/.exec(note)?.[1]) : NaN;
      return Number.isFinite(tail) && tail >= 0;
    })(),
    'a number from the analysis',
  );

  // THE OWNER'S CHOICE: let the film run longer so the card gets a scene of its own and
  // every line is drawn. This is the fix for the defect above, and it is opt-in because
  // it trades the rebuild's headline promise (same runtime) for the words.
  const withCard = rebuildFromAnalysis(shortAnalysis, { endCardScene: true });
  const cardScene = withCard.beats.scenes.find((scene) => scene.kind === 'endcard');
  const beatsInCard = cardScene ? cardScene.beats.length : -1;
  check(
    'asked for a card scene, the card gets one and carries NO lines',
    Boolean(cardScene) && beatsInCard === 0,
    cardScene ? `${cardScene.id} with ${beatsInCard} beat(s)` : 'no card scene',
  );
  check(
    'and every beat then sits in a content scene, so every line is drawn',
    withCard.beats.scenes
      .filter((scene) => scene.kind !== 'endcard')
      .reduce((sum, scene) => sum + scene.beats.length, 0) === withCard.beats.beats.length,
    `${withCard.beats.beats.length} beat(s), all in content scenes`,
  );
  check(
    'the film is that much longer, and the note says so rather than hiding it',
    withCard.timing.total > rebuilt.timing.total + 1 &&
      withCard.notes.some((note) => /runs \d+(\.\d+)?s longer than the reference/i.test(note)),
    `${withCard.timing.total}s vs ${rebuilt.timing.total}s — ${roundTo(withCard.timing.total - rebuilt.timing.total, 3)}s longer`,
  );
  check(
    'the default is unchanged: no card scene unless it was asked for',
    rebuilt.beats.scenes.filter((scene) => scene.kind === 'endcard').length === 1 &&
      rebuilt.timing.total < withCard.timing.total,
    'opt-in, not the default',
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Run
// ────────────────────────────────────────────────────────────────────────────

(async () => {
  checkParsers();
  const analysis = await checkAnalysis();
  checkSpec(analysis);
  checkRebuild(analysis);
  await checkSkill();
  checkCompare();
  await checkEdges();
  await checkFastCut();

  // ── a SQUARE reference must not be cropped into 9:16
  const square = await analyseVideo('square.mp4', {
    ...fakeTools(),
    async probeJson() {
      const parsed = JSON.parse(probeJsonText());
      parsed.streams[0].width = 720;
      parsed.streams[0].height = 720;
      return JSON.stringify(parsed);
    },
  });
  check(
    'a 720x720 reference is measured as 1:1, not forced to 9:16',
    square.facts.aspect === '1:1',
    `${square.facts.width}x${square.facts.height} -> ${square.facts.aspect}`,
  );
  check(
    'the aspect is called by its shape: square within 2%, otherwise portrait or landscape',
    aspectOf(1080, 1080) === '1:1' &&
      aspectOf(1000, 1020) === '1:1' &&
      aspectOf(1920, 1080) === '16:9' &&
      aspectOf(1080, 1920) === '9:16',
    '1:1 / 16:9 / 9:16',
  );
  const squareRebuild = rebuildFromAnalysis(square);
  check(
    'the square rebuild is emitted at 1:1 in a square frame',
    squareRebuild.beats.aspect === '1:1' &&
      (() => {
        const composition = squareRebuild.project.files.find((file) => /s1-hook\.html$/.test(file.path));
        return composition
          ? /data-width="1080"/.test(composition.content) && /data-height="1080"/.test(composition.content)
          : false;
      })(),
    `aspect ${squareRebuild.beats.aspect}, ${squareRebuild.project.files.length} files`,
  );
  check(
    'a square line may be longer than a vertical one but shorter than a wide one',
    MAX_LINE_WORDS['1:1'] > MAX_LINE_WORDS['9:16'] && MAX_LINE_WORDS['1:1'] < MAX_LINE_WORDS['16:9'],
    `9:16=${MAX_LINE_WORDS['9:16']} 1:1=${MAX_LINE_WORDS['1:1']} 16:9=${MAX_LINE_WORDS['16:9']}`,
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
