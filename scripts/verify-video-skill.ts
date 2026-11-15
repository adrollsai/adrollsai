/**
 * Proves the `video` skill's contract WITHOUT a network, a browser or a render.
 *
 * What it pins, and why each one is here rather than in a frame review:
 *
 *  - the clock is derived, monotonic and gapless, and `s0` is exactly the 0.5 s
 *    plate-only lead-in (a scene on screen at t = 0 never reveals its overlays);
 *  - the emitter is deterministic: the same beats + the same measured onsets emit
 *    byte-identical files, which is what makes the R2 key mean anything;
 *  - one beats file drives both aspects, at the same beat count and different
 *    dimensions;
 *  - every element lands inside its own scene's window, and every on-screen line
 *    is on screen long enough to be read (`0.5 s + 0.3 s per word`);
 *  - `.clip` carries a box, a reused plate is copied, the grade is baked with
 *    ffmpeg, and nothing in a composition reads a clock or a random number;
 *  - the quote comes from the registry (`videoCredits`, `estimateCredits`), so a
 *    price change in media-models.ts moves the plan with it.
 *
 *   npm run verify:video-skill
 */
import {
  MAX_LINE_WORDS,
  BeatsError,
  minHoldSeconds,
  parseBeats,
  roundTo,
  type Beats,
} from '../lib/agent/tools/skills/video/beats';
import type { EmitError } from '../lib/agent/tools/skills/video/emit';
import {
  TIMING_DEFAULTS,
  measureVoiceover,
  scenesSelfConsistent,
  toTimingJson,
  type VoOnset,
} from '../lib/agent/tools/skills/video/timing';
import {
  brandBugSize,
  compositionFiles,
  DELIVERY_LRA,
  DELIVERY_LUFS,
  DELIVERY_TRUE_PEAK_DB,
  emitProject,
  emittedText,
  estimatedWidth,
  GRADE_FILTER,
  layoutFor,
  MIN_DELIVERY_PEAK_DB,
  PROJECT_CLI_VERSION,
  projectSlug,
} from '../lib/agent/tools/skills/video/emit';
import {
  checkFindings,
  estimateVideoCredits,
  fatalCheckFindings,
  onsetFromMeasurement,
  parseCheckJson,
  parseSilenceDetect,
  planVideoSkill,
  recordRunArtefact,
  resolveBeats,
  scenePlanFor,
  checkReportCommand,
  silenceDetectCommand,
  trimSilenceCommand,
  voiceArtefactKeyFor,
  artefactKeyFor,
  CLIP_MODEL,
  VOICE_MODEL,
} from '../lib/agent/tools/skills/video/index';
import { MEDIA_MODELS, estimateCredits, videoCredits } from '../lib/agent/media-models';
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

// ────────────────────────────────────────────────────────────────────────────
// The fixture: a small, complete film. Every line and every duration is chosen so
// the readability rule is satisfiable — the point of the checks is the pipeline,
// not a heroic 0.9 s beat.
// ────────────────────────────────────────────────────────────────────────────

function fixtureBeats(): Record<string, unknown> {
  return {
    version: 1,
    jobId: 'meridian-tricity',
    aspect: '9:16',
    fps: 30,
    targetSeconds: 30,
    onScreenLanguage: 'en',
    logoOnScreen: true,
    voice: {
      language: 'hinglish',
      speaker: 'Charon',
      scene: 'Confident Indian narrator, warm authority, Hindi-English mix, no shouting.',
    },
    endCard: {
      name: 'Meridian Group',
      tagline: 'Spaces That Keep Their Promise',
      numbers: ['9876500123', '9876500456'],
      address: ['4th Floor, Sector 34', 'Chandigarh'],
      pledge: 'YOUR NEED, OUR PRIORITY',
      logo: 'assets/brand/logo.png',
    },
    plates: [
      // `hook-a` is played by THREE scenes (s0's lead-in, s1 and s3), which is
      // exactly the case that has to be copied rather than shared.
      { id: 'hook-a', source: 'asset', key: 'assets/src/hook-a.mp4' },
      { id: 'types-a', source: 'generate', prompt: 'slow push in on towers, golden hour', seconds: 5 },
      { id: 'card-a', source: 'asset', key: 'assets/src/card-a.mp4' },
      { id: 'cta-a', source: 'generate', prompt: 'slow pan over a dusk skyline', seconds: 4 },
      { id: 'numbers-a', source: 'asset', key: 'assets/src/numbers-a.mp4' },
      { id: 'end-a', source: 'asset', key: 'assets/src/end-a.mp4' },
    ],
    beats: [
      { id: 'p01', vo: 'Tricity mein ghar dhoond rahe ho?', lines: ['HOME OR', 'PROPERTY?'], label: 'TRICITY PUNJAB', plate: 'hook-a' },
      { id: 'p02', vo: 'Ek BHK se lekar char BHK tak.', lines: ['1BHK TO 4BHK'], label: 'EVERY SIZE', plate: 'types-a' },
      { id: 'p03', vo: 'Har budget ke liye option hai.', lines: ['EVERY BUDGET'], plate: 'types-a' },
      { id: 'p04', vo: 'Mohali, Zirakpur, Kharar.', lines: ['MOHAALI'], plate: 'hook-a' },
      { id: 'p05', vo: 'Landran, Banur, Kurali Road.', lines: ['ZIRAKPUR'], plate: 'hook-a' },
      { id: 'p06', vo: 'Poori Tricity cover karte hain.', lines: ['THE WHOLE TRICITY'], plate: 'hook-a' },
      { id: 'p07', vo: 'Bas teen cheezein bhejo.', lines: ['BUDGET'], label: 'JUST SEND', plate: 'card-a' },
      { id: 'p08', vo: 'Budget, location, property type.', lines: ['LOCATION'], plate: 'card-a' },
      { id: 'p09', vo: 'Abhi call ya WhatsApp karo.', lines: ['CALL NOW', 'OR WHATSAPP'], plate: 'cta-a' },
      { id: 'p10', vo: 'Meridian Group. Aapki zaroorat, hamari zimmedari.', lines: ['MERIDIAN GROUP'], plate: 'end-a' },
    ],
    scenes: [
      { id: 's1', kind: 'hook', beats: ['p01'], plate: 'hook-a' },
      { id: 's2', kind: 'beat', beats: ['p02', 'p03'], plate: 'types-a' },
      { id: 's3', kind: 'list', beats: ['p04', 'p05', 'p06'], plate: 'hook-a' },
      { id: 's4', kind: 'info', beats: ['p07', 'p08'], plate: 'card-a' },
      { id: 's5', kind: 'cta', beats: ['p09'], plate: 'cta-a' },
      { id: 's6', kind: 'numbers', beats: [], dur: 2.4, plate: 'numbers-a' },
      { id: 's7', kind: 'endcard', beats: ['p10'], plate: 'end-a' },
    ],
  };
}

/**
 * Synthetic onsets, as `ffmpeg silencedetect` + `ffprobe` would report them.
 *
 * `start` is the leading silence the trim removed (0.4 s here, so the drift check
 * has something to chew on); `dur` is the speech. These are generous on purpose:
 * a plan whose voice cannot carry its own type must FAIL the readability gate, and
 * that is checked separately with cramped numbers.
 */
const VO_DUR: Record<string, number> = {
  p01: 3.0,
  p02: 2.6,
  p03: 2.4,
  p04: 3.2,
  p05: 2.2,
  p06: 2.6,
  p07: 2.0,
  p08: 2.2,
  p09: 2.2,
  p10: 3.2,
};

function fixtureOnsets(scale = 1): VoOnset[] {
  return Object.keys(VO_DUR).map((id) => ({
    id,
    start: 0,
    lead: 0.4,
    dur: roundTo(VO_DUR[id] * scale, 3),
  }));
}

function fixture(overrides: Record<string, unknown> = {}): Beats {
  return parseBeats({ ...fixtureBeats(), ...overrides });
}

// ────────────────────────────────────────────────────────────────────────────
// 1. The clock
// ────────────────────────────────────────────────────────────────────────────

console.log('=== timing: measured onsets -> a gapless, monotonic clock ===');
{
  const beats = fixture();
  const onsets = fixtureOnsets();
  const timing = measureVoiceover(onsets, scenePlanFor(beats), {
    minTotal: Math.max(beats.targetSeconds, 30),
  });

  check(
    'the clock starts with a 0.5 s plate-only lead-in',
    timing.sceneList.s0.start === 0 && timing.sceneList.s0.dur === 0.5,
    `s0 = ${JSON.stringify(timing.sceneList.s0)}`,
  );

  check(
    'every measured line keeps its measured duration',
    timing.vo.every((line) => near(line.dur, VO_DUR[line.id])),
    timing.vo.map((l) => `${l.id}:${l.dur}`).join(' '),
  );

  const monotonic = timing.vo.every((line, i) => i === 0 || line.start > timing.vo[i - 1].start);
  check('voice starts are strictly monotonic', monotonic, `${timing.vo.length} lines`);

  const noOverlap = timing.vo.every(
    (line, i) => i === 0 || roundTo(timing.vo[i - 1].start + timing.vo[i - 1].dur + TIMING_DEFAULTS.gap, 3) <= line.start + 0.001,
  );
  check(
    `no two spoken lines overlap, and they are ${TIMING_DEFAULTS.gap}s apart`,
    noOverlap,
    timing.vo.map((l) => `${l.start}+${l.dur}`).join(' '),
  );

  const first = timing.vo[0];
  check(
    'the first line opens the hook, just after the lead-in',
    near(first.start, 0.5 + TIMING_DEFAULTS.openOffset) && first.id === 'p01',
    `p01 at ${first.start}s`,
  );

  const sceneIds = Object.keys(timing.sceneList);
  let gapless = true;
  for (let i = 1; i < sceneIds.length; i++) {
    const prev = timing.sceneList[sceneIds[i - 1]];
    if (!near(roundTo(prev.start + prev.dur, 3), timing.sceneList[sceneIds[i]].start, 0.001)) gapless = false;
  }
  check(
    'scenes tile the film with no gap and no overlap (a gap renders black)',
    gapless,
    `${sceneIds.length} scenes`,
  );

  const last = timing.sceneList[sceneIds[sceneIds.length - 1]];
  check(
    'total is exactly the last scene end',
    near(timing.total, roundTo(last.start + last.dur, 3)),
    `total ${timing.total} vs ${roundTo(last.start + last.dur, 3)}`,
  );

  check(
    'the film reaches the declared floor',
    timing.total >= 30,
    `${timing.total}s ≥ 30s`,
  );

  const consistent = scenesSelfConsistent(timing);
  check(
    'every scene is self-consistent (reveals inside the window, exit inside the scene)',
    consistent.ok,
    consistent.problems.join('; ') || 'no problems',
  );

  const json = toTimingJson(timing) as Record<string, any>;
  check(
    'timing.json has the reference shape (total, vo[], sceneList, s1.., vobug)',
    typeof json.total === 'number' &&
      Array.isArray(json.vo) &&
      json.sceneList.s0.dur === 0.5 &&
      Array.isArray(json.s1.beats) &&
      json.vobug.start === 0.5,
    `keys: ${Object.keys(json).slice(0, 6).join(', ')} …`,
  );

  check(
    'the measurement is carried verbatim, so the derivation is auditable',
    timing.measured.length === onsets.length &&
      timing.measured.every((m) => onsets.some((o) => o.id === m.id && o.dur === m.dur)),
    `${timing.measured.length} measured onsets`,
  );
  check(
    'per-line measurements report no drift (the clock IS the measurement)',
    timing.drift === 0 && timing.measured.every((m) => m.lead === 0.4),
    `drift ${timing.drift}s, lead 0.4s per line`,
  );

  // The floor is honoured by holding the end card, never by stretching a beat.
  const short = measureVoiceover(
    fixtureOnsets().map((o) => ({ ...o, dur: roundTo(o.dur * 0.55, 3) })),
    scenePlanFor(beats),
    { minTotal: 30 },
  );
  const spoken = new Set(short.vo.map((v) => v.id));
  check(
    'a short read is absorbed by the end card, and no spoken line is stretched',
    short.total >= 30 &&
      Object.entries(VO_DUR).every(([id, dur]) =>
        spoken.has(id) ? near(short.vo.find((v) => v.id === id)!.dur, roundTo(dur * 0.55, 3)) : true,
      ),
    `${short.total}s with the end card holding`,
  );

  // An onset for a line no scene carries is money spent on a line nobody hears.
  const orphan = throws(() =>
    measureVoiceover([...fixtureOnsets(), { id: 'p99', start: 0.4, dur: 1.2 }], scenePlanFor(beats)),
  );
  check('a measured line that belongs to no scene is rejected', orphan.threw, orphan.message.slice(0, 90));

  const missing = throws(() =>
    measureVoiceover(fixtureOnsets().slice(0, 3), scenePlanFor(beats)),
  );
  check('a spoken beat with no measurement is rejected', missing.threw, missing.message.slice(0, 90));
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Determinism
// ────────────────────────────────────────────────────────────────────────────

console.log('\n=== emit: same beats + same onsets -> byte-identical project ===');
const beats = fixture();
const onsets = fixtureOnsets();
const timing = measureVoiceover(onsets, scenePlanFor(beats), { minTotal: 30 });
const first = emitProject(beats, timing);
const second = emitProject(parseBeats(JSON.parse(JSON.stringify(fixtureBeats()))), timing);

check(
  'two emits of the same input are byte-identical',
  emittedText(first) === emittedText(second),
  `${first.files.length} files, ${emittedText(first).length} bytes`,
);
check(
  'the project slug is a pure function of the plan',
  first.seed === second.seed && projectSlug(beats) === `${beats.jobId}-9x16-${first.seed}`,
  projectSlug(beats),
);
check(
  'a changed plan gets a different slug (a re-render is a new artefact, not an overwrite)',
  projectSlug(parseBeats({ ...fixtureBeats(), jobId: 'meridian-tricity-2' })) !== projectSlug(beats),
  'jobId is part of the key',
);

{
  const clock = compositionFiles(first).filter((file) => /Date\.now|Math\.random|performance\.now/.test(file.content));
  check(
    'no composition reads a clock or a random number',
    clock.length === 0,
    clock.length ? clock.map((f) => f.path).join(', ') : `${compositionFiles(first).length} composition files clean`,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 3. One beats file, two aspects
// ────────────────────────────────────────────────────────────────────────────

console.log('\n=== aspects: one beats file drives 9:16 and 16:9 ===');
{
  const wideBeats = parseBeats({ ...fixtureBeats(), aspect: '16:9' });
  const wideTiming = measureVoiceover(onsets, scenePlanFor(wideBeats), { minTotal: 30 });
  const wide = emitProject(wideBeats, wideTiming);

  check(
    'the same beats emit the same beat count in both aspects',
    wide.scenes.length === first.scenes.length && timing.vo.length === wideTiming.vo.length,
    `${first.scenes.length} scenes / ${timing.vo.length} voice lines in both`,
  );
  check(
    'the two aspects have different dimensions',
    first.width === 1080 && first.height === 1920 && wide.width === 1920 && wide.height === 1080,
    `${first.width}x${first.height} vs ${wide.width}x${wide.height}`,
  );
  check(
    'the root composition declares the aspect it was emitted for',
    first.files.find((f) => f.path === 'index.html')!.content.includes('data-width="1080"') &&
      wide.files.find((f) => f.path === 'index.html')!.content.includes('data-width="1920"'),
    'data-width follows the aspect',
  );
  check(
    'the timing is identical across aspects (geometry changes, the clock does not)',
    emittedText(emitProject(beats, timing)) === emittedText(first) &&
      wideTiming.total === timing.total,
    `total ${timing.total}s in both`,
  );
  check(
    '16:9 allows longer lines than 9:16, and the limit is enforced',
    MAX_LINE_WORDS['16:9'] > MAX_LINE_WORDS['9:16'] &&
      throws(() =>
        parseBeats({
          ...fixtureBeats(),
          beats: [
            { id: 'p01', vo: 'x', lines: ['one two three four five six'], plate: 'hook-a' },
            ...(fixtureBeats().beats as any[]).slice(1),
          ],
        }),
      ).threw,
    `${MAX_LINE_WORDS['9:16']} words at 9:16, ${MAX_LINE_WORDS['16:9']} at 16:9`,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 4. Every element inside its own window
// ────────────────────────────────────────────────────────────────────────────

console.log('\n=== scenes: every element lands inside its own window ===');
{
  const problems: string[] = [];
  for (const scene of beats.scenes) {
    const sceneTiming = timing.scenes[scene.id];
    for (const reveal of sceneTiming.beats) {
      if (!(reveal >= 0 && reveal < sceneTiming.dur)) {
        problems.push(`${scene.id}: reveal ${reveal}s outside its ${sceneTiming.dur}s window`);
      }
      if (reveal > sceneTiming.out) {
        problems.push(`${scene.id}: reveal ${reveal}s after its exit at ${sceneTiming.out}s`);
      }
    }
    if (sceneTiming.out > sceneTiming.dur) {
      problems.push(`${scene.id}: exit ${sceneTiming.out}s past the scene end`);
    }
  }
  check(
    'every beat reveal is inside its scene, and before that scene exits',
    problems.length === 0,
    problems.join('; ') || `${beats.scenes.length} scenes checked`,
  );

  const unplaced = first.typeRead.filter(
    (line) => !(line.reveal >= 0 && line.reveal + line.hold <= timing.scenes[line.scene].dur + 0.002),
  );
  check(
    'every emitted text block is revealed and gone inside its own scene',
    unplaced.length === 0,
    unplaced.map((l) => `${l.scene}/${l.text}`).join(', ') || `${first.typeRead.length} blocks`,
  );

  const revealFloor = first.typeRead.filter((line) => line.reveal < 0.12);
  check(
    'nothing is revealed on a scene’s first frame (a .clip overlay needs one frame of lead)',
    revealFloor.length === 0,
    `floor ${TIMING_DEFAULTS.revealFloor}s`,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 5. Readable type
// ────────────────────────────────────────────────────────────────────────────

console.log('\n=== type: 0.5 s + 0.3 s per word, on every line ===');
{
  const short = first.typeRead.filter((line) => line.hold + 1e-9 < minHoldSeconds(line.words));
  check(
    'every on-screen line is on screen long enough to read',
    short.length === 0,
    short.map((l) => `${l.scene}/${l.beat} "${l.text}" ${l.hold}s < ${l.minHold}s`).join('; ') ||
      `${first.typeRead.length} lines, tightest ${Math.min(
        ...first.typeRead.map((l) => roundTo(l.hold / l.minHold, 2)),
      )}x budget`,
  );
  check(
    'the rule itself is 0.5 s + 0.3 s per word',
    minHoldSeconds(1) === 0.8 && minHoldSeconds(5) === 2.0,
    `1 word ${minHoldSeconds(1)}s, 5 words ${minHoldSeconds(5)}s`,
  );

  // A voice too fast for its own copy must FAIL, loudly, before anything renders.
  const cramped = measureVoiceover(
    fixtureOnsets().map((o) => ({ ...o, dur: 0.45 })),
    scenePlanFor(beats),
    { minTotal: 30 },
  );
  const refusal = throws(() => emitProject(beats, cramped));
  const refusalError = refusal as { threw: boolean; message: string };
  check(
    'a plan whose voice cannot carry its type is refused (not shipped)',
    refusalError.threw && /needs .*s \(0\.5s \+ 0\.3s/.test(refusalError.message),
    refusalError.message.slice(0, 120),
  );

  const crowded = throws(() =>
    parseBeats({
      ...fixtureBeats(),
      beats: [
        { id: 'p01', vo: 'x', lines: ['THE QUICK BROWN FOX JUMPS OVER'], plate: 'hook-a' },
        ...(fixtureBeats().beats as any[]).slice(1),
      ],
    }),
  );
  check(
    'a line past the 5-word ceiling at 9:16 is rejected at parse time',
    crowded.threw && /at most 5/.test(crowded.message),
    crowded.message.slice(0, 110),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 6. The four traps that cost renders
// ────────────────────────────────────────────────────────────────────────────

console.log('\n=== traps: the .clip box, the lead-in, the copied plate, the baked grade ===');
{
  const compositions = compositionFiles(first);
  const withoutBox = compositions.filter(
    (file) => !/\.clip\s*\{\s*position:\s*absolute;\s*inset:\s*0;\s*\}/.test(file.content),
  );
  check(
    'every composition gives .clip a box (position:absolute; inset:0)',
    withoutBox.length === 0,
    withoutBox.map((f) => f.path).join(', ') || `${compositions.length} files`,
  );

  const lead = first.files.find((f) => f.path === 'compositions/s0-lead.html')!;
  const leadTextBlocks = (lead.content.match(/class="[^"]*\btxt\b/g) ?? []).length;
  check(
    's0-lead is plate-only: 0.5 s of footage with no overlay at all',
    lead.content.includes('<video') &&
      leadTextBlocks === 0 &&
      lead.content.includes(`data-duration="0.5"`) &&
      lead.content.includes('data-composition-id="s0-lead"'),
    `${leadTextBlocks} text blocks, 0.5 s`,
  );
  check(
    'index.html opens on s0-lead, so the hook is always a later scene',
    /id="s0-lead"[\s\S]{0,400}data-start="0"/.test(
      first.files.find((f) => f.path === 'index.html')!.content,
    ),
    's0-lead at t=0',
  );

  // hook-a is played by s1 AND s3 (p05). Trap 3: one source, two scenes, never.
  const hookUses = first.plates.filter((use) => use.plate === 'hook-a');
  const hookFiles = new Set(hookUses.map((use) => use.file));
  check(
    'a plate used by two scenes is copied, one file per scene',
    hookUses.length >= 2 && hookFiles.size === hookUses.length && hookUses.every((use) => use.copied),
    hookUses.map((use) => use.file.replace('assets/footage/', '')).join(' | '),
  );
  const sharedFiles = first.plates.filter(
    (use, i) => first.plates.findIndex((other) => other.file === use.file) !== i,
  );
  check(
    'no two scenes reference the same plate file',
    sharedFiles.length === 0,
    sharedFiles.map((u) => u.file).join(', ') || `${first.plates.length} plate usages, all distinct`,
  );
  const grading = first.files.find((f) => f.path === 'grading.sh')!.content;
  check(
    'grading.sh makes every copy for real (cp -f, one per scene)',
    first.copies.length >= 2 &&
      first.copies.every((copy) => grading.includes(`cp -f "${copy.from}" "${copy.to}"`)),
    `${first.copies.length} copies`,
  );
  check(
    'the grade is baked with ffmpeg (eq, colorbalance, unsharp, vignette, noise) — never a CSS filter',
    ['eq=', 'colorbalance=', 'unsharp=', 'vignette=', 'noise='].every((token) =>
      GRADE_FILTER.includes(token),
    ) &&
      grading.includes('$FFMPEG') &&
      !compositions.some((file) => /filter:\s*(saturate|contrast|sepia|grayscale)\(/.test(file.content)),
    'one warm grade across every plate',
  );

  // ── AUDIO. The first proof film measured -31.6 LUFS with a -26.2 dB peak: about 4%
  // of full scale, inaudible on a phone. Three assertions on the emitted command
  // lists keep that from regressing, none of which needs a render.
  const plateCommands = grading
    .split(/\r?\n/)
    .filter((line) => line.includes('$FFMPEG') && line.includes('-vf'));
  check(
    'every plate-to-scene conversion strips audio with -an (a plate never brings sound)',
    plateCommands.length >= 5 && plateCommands.every((line) => /(^|\s)-an(\s|$)/.test(line)),
    `${plateCommands.length} plate conversions, all with -an`,
  );
  const videoTags = compositions.flatMap((file) => file.content.match(/<video[^>]*>/g) ?? []);
  check(
    'every <video> is muted, so no plate audio can reach the mix',
    videoTags.length >= 6 && videoTags.every((tag) => /\bmuted\b/.test(tag)),
    `${videoTags.length} video tags, all muted`,
  );

  const master = first.files.find((file) => file.path === 'master.sh')?.content ?? '';
  check(
    'the project carries a mastering pass with an explicit loudness target',
    master.includes(`loudnorm=I=${DELIVERY_LUFS}:TP=${DELIVERY_TRUE_PEAK_DB}:LRA=${DELIVERY_LRA}`) &&
      DELIVERY_LUFS === -16 &&
      DELIVERY_TRUE_PEAK_DB === -1.5 &&
      DELIVERY_LRA === 11,
    `${DELIVERY_LUFS} LUFS / ${DELIVERY_TRUE_PEAK_DB} dBTP`,
  );
  check(
    'loudness is normalised in exactly ONE place (master.sh), never stacked',
    (() => {
      // "One pass, not both": loudness may be touched in master.sh and nowhere else —
      // not in grading.sh, not in the voice step (whose commands are exported so they
      // can be asserted here too). Inside that one stage are two ffmpeg invocations,
      // measure then apply, because a LINEAR gain needs the measurement first.
      const count = (text: string) => (text.match(/loudnorm/g) ?? []).length;
      const elsewhere = {
        grading: count(grading),
        trim: count(trimSilenceCommand('/w/a.wav', '/w/b.wav')),
        detect: count(silenceDetectCommand('/w/a.wav')),
      };
      return (
        count(master) > 0 &&
        elsewhere.grading === 0 &&
        elsewhere.trim === 0 &&
        elsewhere.detect === 0
      );
    })(),
    `master.sh=${(master.match(/loudnorm/g) ?? []).length}, grading.sh=${(grading.match(/loudnorm/g) ?? []).length}, voice step=0`,
  );
  check(
    'that one stage is measure-then-apply: linear gain, not a compressor',
    /loudnorm=I=.*print_format=json/.test(master) &&
      /loudnorm=I=.*measured_I=/.test(master) &&
      master.includes('linear=true') &&
      (master.match(/loudnorm=I=/g) ?? []).length === 2,
    'pass 1 measures, pass 2 applies with linear=true',
  );
  check(
    'master.sh measures the file it wrote and fails below -12 dB peak',
    MIN_DELIVERY_PEAK_DB === -12 &&
      master.includes('volumedetect') &&
      master.includes('ebur128') &&
      master.includes('MIN_PEAK=-12') &&
      /too quiet for delivery/.test(master) &&
      /exit 3/.test(master),
    'peak and integrated loudness both gated',
  );
  check(
    'a film with no audio stream is refused rather than published silent',
    /has no audio stream/.test(master) && /exit 4/.test(master),
    'exit 4',
  );

  check(
    'the CLI version is pinned, so a project re-renders identically',
    PROJECT_CLI_VERSION === '0.9.43' && grading.length > 0 &&
      first.files.find((f) => f.path === 'package.json')!.content.includes(`hyperframes@${PROJECT_CLI_VERSION}`),
    PROJECT_CLI_VERSION,
  );

  const safe = layoutFor('9:16');
  check(
    'the 9:16 safe band matches the reference film (nothing above 168 px, words above 1330 px)',
    safe.safeTop === 168 && safe.safeBottom === 1330 && safe.width === 1080 && safe.height === 1920,
    `${safe.safeTop}-${safe.safeBottom} px`,
  );

  // The brand bug shipped once as a root-level `<div class="clip">` with an `<img>`
  // inside: `.clip` brings `inset: 0`, so a width-only box stretched to full height and
  // painted an opaque cream bar over the left fifth of every frame, while `check`
  // reported ok with a zero-size bbox. It is a SUB-COMPOSITION now, with a real box.
  const root = first.files.find((f) => f.path === 'index.html')!.content;
  const bugSlot = root.match(/<div\s+id="brand-bug"[\s\S]*?><\/div>/)?.[0] ?? '';
  check(
    'the brand bug is its own sub-composition with an explicit box',
    first.files.some((f) => f.path === 'compositions/brand-bug.html') &&
      bugSlot.includes('data-composition-src="compositions/brand-bug.html"') &&
      /data-width="\d+"/.test(bugSlot) &&
      /data-height="\d+"/.test(bugSlot) &&
      /style="[^"]*left:\s*\d+px;[^"]*top:\s*\d+px;[^"]*width:\s*\d+px;[^"]*height:\s*\d+px;/.test(bugSlot),
    bugSlot ? 'slot has src + width + height + position' : 'no brand-bug slot',
  );
  check(
    'the brand bug slot carries no .clip class (inset:0 must never size it)',
    bugSlot.length > 0 && !/class="[^"]*\bclip\b/.test(bugSlot) && !/#brand-bug\s*\{[^}]*inset:/.test(root),
    'no clip class, no inset rule',
  );
  {
    const bugLayout = layoutFor('9:16');
    const size = brandBugSize(bugLayout);
    const bug = first.files.find((f) => f.path === 'compositions/brand-bug.html')!.content;
    check(
      'the brand bug plate is small, fixed-size, and above the type band',
      size.width === Math.round(bugLayout.width * 0.198) &&
        size.height < bugLayout.height * 0.1 &&
        size.top >= bugLayout.safeTop &&
        size.top + size.height <= bugLayout.safeTop + Math.round((bugLayout.safeBottom - bugLayout.safeTop) * 0.16) &&
        bug.includes(`data-width="${size.width}"`) &&
        bug.includes('object-fit: contain'),
      `${size.width}x${size.height} at (${size.left}, ${size.top})`,
    );
  }

  // Read the positions back out of the emitted CSS: the safe area is a property of
  // the files that will render, not of the numbers the emitter hoped for.
  const boxes: { file: string; id: string; top: number; size: number }[] = [];
  for (const file of compositions) {
    const re = /#(a-[\w-]+)\s*\{\s*top:\s*([\d.]+)px;\s*font-size:\s*([\d.]+)px;/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(file.content))) {
      boxes.push({ file: file.path, id: match[1], top: Number(match[2]), size: Number(match[3]) });
    }
  }
  const outOfBand = boxes.filter(
    (box) => box.top < safe.safeTop || box.top + box.size * 1.5 > safe.safeBottom + 1,
  );
  check(
    'every emitted text block sits inside the 168–1330 px band',
    boxes.length >= 15 && outOfBand.length === 0,
    outOfBand.map((b) => `${b.id} at ${b.top}px`).join(', ') || `${boxes.length} blocks inside the band`,
  );

  // HORIZONTAL safe area: type is `nowrap`, so a line wider than the 948 px box runs
  // out of the frame and is cropped. Two delivered frames read "…OPERTY?" and "…4BHK".
  const safeWidth = safe.width - 2 * safe.margin;
  const overflowing = first.typeRead.filter(
    (line) => !line.fitsFrame || line.left < safe.margin || line.left + line.width > safe.width - safe.margin,
  );
  check(
    'every on-screen line sits inside the safe box horizontally (nothing clips the frame edge)',
    overflowing.length === 0 && first.typeRead.length >= 15,
    overflowing
      .map((l) => `${l.scene} "${l.text}" ${l.left}+${l.width}px`)
      .join(', ') ||
      `${first.typeRead.length} lines, widest ${Math.max(...first.typeRead.map((l) => l.width))}px in ${safeWidth}px`,
  );
  check(
    'no emitted element is positioned outside the frame',
    boxes.every((box) => box.top >= 0 && box.top + box.size <= safe.height) &&
      first.typeRead.every((line) => line.left >= 0),
    `${boxes.length} blocks inside 0-${safe.height}px`,
  );
  {
    // The fitter has to actually fire: a five-word hook line at 128 px would be
    // ~1030 px wide in a 948 px box, so it must be stepped down.
    const longBeats = parseBeats({
      ...fixtureBeats(),
      beats: [
        { id: 'p01', vo: 'Tricity mein ghar dhoond rahe ho?', lines: ['PROPERTY FINDER'], plate: 'hook-a' },
        ...(fixtureBeats().beats as any[]).slice(1),
      ],
    });
    const longTiming = measureVoiceover(fixtureOnsets(), scenePlanFor(longBeats), { minTotal: 30 });
    const longProject = emitProject(longBeats, longTiming);
    const hookLine = longProject.typeRead.find((line) => line.text === 'PROPERTY FINDER')!;
    check(
      'a long line is stepped down the size ladder until it fits the safe box',
      hookLine.size < layoutFor('9:16').hookSize &&
        hookLine.width <= safeWidth &&
        estimatedWidth('PROPERTY FINDER', layoutFor('9:16').hookSize) > safeWidth,
      `${hookLine.size}px (base ${layoutFor('9:16').hookSize}px), ~${hookLine.width}px wide`,
    );
  }

  const fourLines = throws(() =>
    parseBeats({
      ...fixtureBeats(),
      beats: [
        { id: 'p01', vo: 'x', lines: ['ONE', 'TWO', 'THREE', 'FOUR'], plate: 'hook-a' },
        ...(fixtureBeats().beats as any[]).slice(1),
      ],
    }),
  );
  check(
    'a beat may reveal at most three lines (a fourth cannot be read inside one window)',
    fourLines.threw && /three is the maximum/.test(fourLines.message),
    fourLines.message.slice(0, 100),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 7. Money: the quote comes from the registry
// ────────────────────────────────────────────────────────────────────────────

console.log('\n=== credits: quoted from the registry, before any spend ===');
{
  const plan = planVideoSkill({ beats: fixtureBeats() });
  const generatedSeconds = 5 + 4; // types-a + cta-a
  const lines = (fixtureBeats().beats as any[]).filter((b) => String(b.vo).trim()).length;

  check(
    'the motion quote is videoCredits(seconds)',
    plan.credits.clips === videoCredits(generatedSeconds),
    `${plan.credits.clips} = videoCredits(${generatedSeconds}) = ${videoCredits(generatedSeconds)}`,
  );
  check(
    'the voice quote is estimateCredits("voice", lines)',
    plan.credits.voice === estimateCredits('voice', lines),
    `${plan.credits.voice} = estimateCredits('voice', ${lines})`,
  );
  check(
    'the render quote is the pipeline’s own RENDER_CREDITS',
    plan.credits.render === RENDER_CREDITS,
    `${plan.credits.render}`,
  );
  check(
    'the total is the sum of the three steps',
    plan.credits.total === plan.credits.voice + plan.credits.clips + plan.credits.render &&
      plan.steps.reduce((sum, step) => sum + step.credits, 0) === plan.credits.total,
    `${plan.credits.total} credits across ${plan.steps.length} steps`,
  );
  check(
    'the plan names the registry ids it will spend on, and nothing else',
    plan.credits.lines[0].media === MEDIA_MODELS.voice.id &&
      plan.credits.lines[1].media === MEDIA_MODELS.video.id &&
      VOICE_MODEL === MEDIA_MODELS.voice.id &&
      CLIP_MODEL === MEDIA_MODELS.video.id,
    `${plan.credits.lines[0].media} + ${plan.credits.lines[1].media}`,
  );
  check(
    'the plan quotes the exact R2 key the film will land on',
    plan.artefactKey === artefactKeyFor(beats) && plan.artefactKey === `video/${projectSlug(beats)}/final.mp4`,
    plan.artefactKey,
  );
  check(
    'the measured-voice key is a sibling of the film’s key (resume path)',
    voiceArtefactKeyFor(beats).startsWith(`video/${projectSlug(beats)}/`),
    voiceArtefactKeyFor(beats),
  );
  check(
    'an asset-only plan buys no motion',
    estimateVideoCredits(
      parseBeats({
        ...fixtureBeats(),
        plates: (fixtureBeats().plates as any[]).map((p) => ({ id: p.id, source: 'asset', key: `assets/src/${p.id}.mp4` })),
      }),
    ).clips === 0,
    '0 credits of motion',
  );
  check(
    'consequential overrides (aspect, length, logo, languages, end card) land on the plan',
    (() => {
      const overridden = planVideoSkill({
        beats: fixtureBeats(),
        aspect: '16:9',
        targetSeconds: 45,
        logoOnScreen: false,
        voiceLanguage: 'hindi',
        endCard: { tagline: 'Built To Last' },
      }).beats;
      return (
        overridden.aspect === '16:9' &&
        overridden.targetSeconds === 45 &&
        overridden.logoOnScreen === false &&
        overridden.voice.language === 'hindi' &&
        overridden.endCard.tagline === 'Built To Last' &&
        overridden.endCard.name === 'Meridian Group'
      );
    })(),
    'one beats file, per-delivery overrides',
  );
  check(
    'a target under 30 s is refused',
    throws(() => planVideoSkill({ beats: { ...fixtureBeats(), targetSeconds: 18 } })).threw,
    'the floor is enforced at parse time',
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 8. The measurement + bookkeeping helpers
// ────────────────────────────────────────────────────────────────────────────

console.log('\n=== measurement + run record ===');
{
  const stderr = [
    '[silencedetect @ 0x1] silence_start: 0',
    '[silencedetect @ 0x1] silence_end: 0.412 | silence_duration: 0.412',
    '[silencedetect @ 0x1] silence_start: 3.106',
    '[silencedetect @ 0x1] silence_end: 3.4 | silence_duration: 0.294',
  ].join('\n');
  const spans = parseSilenceDetect(stderr);
  check(
    'silencedetect output parses into spans',
    spans.length === 2 && near(spans[0].start, 0) && near(spans[0].end, 0.412) && near(spans[1].start, 3.106),
    spans.map((s) => `${s.start}-${s.end}`).join(' '),
  );

  const onset = onsetFromMeasurement('p01', 3.4, spans);
  check(
    'a measured line becomes { speech, lead } with the trim recorded',
    onset.id === 'p01' && onset.start === 0 && near(onset.dur, 2.694) && near(onset.lead ?? 0, 0.412),
    `dur ${onset.dur}s, lead ${onset.lead}s of a 3.4s file`,
  );

  const clean = onsetFromMeasurement('p02', 2.0, [{ start: 0, end: 0 }, { start: 2.0, end: 2.0 }]);
  check(
    'an already-trimmed line reports lead 0 and its own length as speech',
    (clean.lead ?? -1) === 0 && near(clean.dur, 2.0) && clean.start === 0,
    `lead ${clean.lead}s / dur ${clean.dur}s`,
  );

  const parsed = parseCheckJson(
    JSON.stringify({ summary: { errors: 0, warnings: 26 }, findings: [{ level: 'info' }] }),
  );
  check(
    'check --json is read defensively (0 errors, 26 warnings)',
    parsed.errors === 0 && parsed.warnings === 26,
    `${parsed.errors} errors / ${parsed.warnings} warnings`,
  );

  // The shape the CLI actually saves: one section per audit, each with counts.
  const sectioned = parseCheckJson(
    JSON.stringify({
      ok: false,
      strict: false,
      lint: { ok: false, errorCount: 10, warningCount: 1, findings: [] },
      runtime: { ok: false, errorCount: 1, warningCount: 0, findings: [] },
      layout: { ok: true, errorCount: 0, warningCount: 0, findings: [] },
      motion: { ok: true, errorCount: 0, warningCount: 2, findings: [] },
    }),
  );
  check(
    'the sectioned report file is summed, not misread (10+1 errors, 1+2 warnings)',
    sectioned.errors === 11 && sectioned.warnings === 3,
    `${sectioned.errors} errors / ${sectioned.warnings} warnings`,
  );
  check(
    'a check report with no error count is a failure, not a clean bill',
    throws(() => parseCheckJson('{"findings":[{"level":"info"}]}')).threw,
    'refuses to read "unknown" as "zero"',
  );
  check(
    'the check artefact path is the CLI’s own report file',
    checkReportCommand().includes('.hyperframes/artifacts/checks'),
    checkReportCommand(),
  );

  // THE HIDDEN-OVERLAY GATE. This is the exact finding the CLI produced for the
  // root-level brand bug that shipped past a clean check and painted a cream bar over
  // every frame: severity "warning", a zero-size bbox, ok: true. It must stop a render.
  const brandBugReport = {
    ok: true,
    lint: {
      ok: true,
      errorCount: 0,
      warningCount: 1,
      findings: [
        {
          code: 'nested_structure_needs_subcomposition',
          severity: 'warning',
          message:
            '<div id="brand-bug"> is a timeline element that contains nested <img>. The timeline shows ' +
            'one row per top-level element…',
          selector: '#brand-bug',
          bbox: { x: 0, y: 0, width: 0, height: 0 },
        },
      ],
    },
  };
  const fatal = fatalCheckFindings(brandBugReport);
  check(
    'a zero-size bbox finding stops the render even though check says ok:true',
    fatal.length === 1 &&
      fatal[0].includes('nested_structure_needs_subcomposition') &&
      fatal[0].includes('#brand-bug'),
    fatal[0]?.slice(0, 90) ?? 'nothing flagged',
  );
  check(
    'checkFindings reads findings from sections and from the root',
    checkFindings(brandBugReport).length === 1 &&
      checkFindings({ findings: [{ code: 'x', severity: 'error' }] }).length === 1,
    'both shapes',
  );
  check(
    'a clean report has nothing fatal to say',
    fatalCheckFindings({ lint: { errorCount: 0, findings: [] }, layout: { errorCount: 0, findings: [] } })
      .length === 0,
    '0 fatal findings',
  );
  check(
    'an unresolvable-font finding is NOT fatal (it is a style opinion, not a hidden box)',
    fatalCheckFindings({
      lint: {
        errorCount: 0,
        findings: [{ code: 'font_family_without_font_face', severity: 'error', message: 'Font family used without @font-face: impact.' }],
      },
    }).length === 0,
    'errors are already counted separately',
  );

  // A fake PostgREST: the writer is the only thing between a finished render and a
  // run row that says nothing.
  function fakeSupabase(fail?: { code: string; message: string }) {
    const writes: Record<string, unknown>[] = [];
    return {
      writes,
      from(table: string) {
        return {
          update(values: Record<string, unknown>) {
            writes.push({ table, ...values });
            return {
              async eq(column: string, value: string) {
                writes[writes.length - 1].where = `${column}=${value}`;
                return { error: fail ?? null };
              },
            };
          },
        };
      },
    };
  }

  const artefact = {
    key: 'video/x/final.mp4',
    url: 'https://cdn.example/video/x/final.mp4',
    seconds: 32.04,
    bytes: 123456,
    fps: 30,
    aspect: '9:16' as const,
    slug: 'x',
    jobId: 'x',
    check: { errors: 0, warnings: 3 },
  };

  const okDb = fakeSupabase();
  const recorded = await recordRunArtefact(okDb, 'run-1', artefact);
  const write = okDb.writes[0] ?? {};
  check(
    'the R2 key is written onto the run row',
    recorded.recorded &&
      write.table === 'agent_runs' &&
      write.artefact_key === 'video/x/final.mp4' &&
      write.artefact_url === artefact.url &&
      (write.artefact_meta as any)?.seconds === 32.04 &&
      write.where === 'run_id=run-1',
    `${String(write.where)} → ${String(write.artefact_key)}`,
  );

  const oldDb = fakeSupabase({
    code: 'PGRST204',
    message: "Could not find the 'artefact_key' column of 'agent_runs' in the schema cache",
  });
  const missingColumn = await recordRunArtefact(oldDb, 'run-2', artefact);
  check(
    'a database without the migration is reported, not thrown (a finished render stays finished)',
    !missingColumn.recorded && /20261216000000_agent_run_artefact\.sql/.test(String(missingColumn.reason)),
    String(missingColumn.reason).slice(0, 96),
  );
  check(
    'no Supabase at all is also a report, not a crash',
    (await recordRunArtefact(null, 'run-3', artefact)).recorded === false,
    'recorded: false',
  );

  const resolveNoOverride = resolveBeats({ beats: fixtureBeats() });
  check(
    'resolveBeats never mutates the caller’s object',
    resolveNoOverride.aspect === '9:16' && fixtureBeats().aspect === '9:16',
    'pure',
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 9. The schema itself
// ────────────────────────────────────────────────────────────────────────────

console.log('\n=== beats.json schema ===');
{
  const good = parseBeats(fixtureBeats());
  check(
    'a complete beats file parses, with every derived field filled in',
    good.version === 1 &&
      good.beats.length === 10 &&
      good.scenes.length === 7 &&
      good.endCard.numbers.length === 2 &&
      good.fps === 30,
    `${good.beats.length} beats, ${good.scenes.length} scenes`,
  );

  const cases: { name: string; raw: Record<string, unknown>; pattern: RegExp }[] = [
    { name: 'a missing version', raw: { ...fixtureBeats(), version: undefined }, pattern: /version/ },
    { name: 'a generated (uppercase) jobId', raw: { ...fixtureBeats(), jobId: 'Meridian Film' }, pattern: /jobId/ },
    { name: 'an unsupported aspect', raw: { ...fixtureBeats(), aspect: '4:5' }, pattern: /aspect/ },
    { name: 'an unsupported fps', raw: { ...fixtureBeats(), fps: 29.97 }, pattern: /fps/ },
    {
      name: 'three end-card numbers',
      raw: { ...fixtureBeats(), endCard: { ...(fixtureBeats().endCard as any), numbers: ['1', '2', '3'] } },
      pattern: /exactly two/,
    },
    {
      name: 'a beat in two scenes',
      raw: {
        ...fixtureBeats(),
        scenes: [
          { id: 's1', kind: 'hook', beats: ['p01', 'p02'], plate: 'hook-a' },
          { id: 's2', kind: 'beat', beats: ['p02'], plate: 'types-a' },
          { id: 's7', kind: 'endcard', beats: ['p10'], plate: 'end-a' },
        ],
      },
      pattern: /already belongs to another scene/,
    },
    {
      name: 'an unplaced beat',
      raw: {
        ...fixtureBeats(),
        scenes: [
          { id: 's1', kind: 'hook', beats: ['p01'], plate: 'hook-a' },
          { id: 's7', kind: 'endcard', beats: ['p10'], plate: 'end-a' },
        ],
      },
      pattern: /unplaced|exactly one scene/,
    },
    {
      name: 'a last scene that is not an end card',
      raw: {
        ...fixtureBeats(),
        scenes: [
          { id: 's1', kind: 'hook', beats: ['p01', 'p02', 'p03', 'p04', 'p05', 'p06', 'p07', 'p08', 'p09'], plate: 'hook-a' },
          { id: 's2', kind: 'beat', beats: ['p10'], plate: 'end-a' },
        ],
      },
      pattern: /endcard/,
    },
    {
      name: 'a 7-second generated plate',
      raw: {
        ...fixtureBeats(),
        plates: (fixtureBeats().plates as any[]).map((p) =>
          p.id === 'types-a' ? { ...p, seconds: 7 } : p,
        ),
      },
      pattern: /1-6/,
    },
  ];

  for (const testCase of cases) {
    const result = throws(() => parseBeats(testCase.raw));
    check(
      `rejects ${testCase.name}`,
      result.threw && testCase.pattern.test(result.message),
      result.message.slice(0, 100) || 'no error thrown',
    );
  }

  const foreign = throws(() =>
    parseBeats({
      ...fixtureBeats(),
      beats: [
        { id: 'p01', vo: 'x', lines: ['ਘਰ ਲੱਭ ਰਹੇ ਹੋ'], plate: 'hook-a' },
        ...(fixtureBeats().beats as any[]).slice(1),
      ],
    }),
  );
  check(
    'on-screen copy is English unless the plan asks for another language',
    foreign.threw && /onScreenLanguage/.test(foreign.message),
    foreign.message.slice(0, 100),
  );

  const asked = throws(() =>
    parseBeats({
      ...fixtureBeats(),
      onScreenLanguage: 'pa',
      beats: [
        { id: 'p01', vo: 'x', lines: ['ਘਰ ਲੱਭ ਰਹੇ ਹੋ'], plate: 'hook-a' },
        ...(fixtureBeats().beats as any[]).slice(1),
      ],
    }),
  );
  check(
    'the same line is accepted once the language is asked for',
    !asked.threw,
    'onScreenLanguage: pa',
  );

  check(
    'a BeatsError names the exact path that is wrong',
    throws(() => parseBeats({ ...fixtureBeats(), beats: [{ id: 'p01', vo: 'x', lines: [] }] })).message.includes(
      'beats[0].lines',
    ),
    'beats[0].lines',
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Result
// ────────────────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
