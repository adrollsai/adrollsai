/**
 * beats.json — the `video` skill's input contract.
 *
 * ONE beats file describes a film for either aspect (`9:16` or `16:9`): the voice
 * lines, what each line puts on screen, which plates carry it, and the end card.
 * Everything downstream — the measured `timing.json`, the HyperFrames project,
 * the render — is derived from this and from the rendered voiceover. Nothing here
 * is timed by hand: a beat carries WORDS, and timing.ts turns measured voice
 * onsets into the clock.
 *
 * PURE. This module has no I/O, no clock and no randomness, so a plan can be
 * validated (and its cost quoted) before a single credit is spent.
 *
 * The rules encoded here are the ones the gnr-homes-tricity reference film paid
 * for in render failures and QA passes:
 *
 *  - type has to be readable: `0.5 s + 0.3 s per word`, and a line at 9:16 is at
 *    most 5 words (see MAX_LINE_WORDS, checked here rather than discovered in a
 *    frame);
 *  - the film is at least 30 s, because a shorter cut is not a film;
 *  - on-screen copy is English unless the caller explicitly asks for a language,
 *    in which case it must LOOK deliberate (see `onScreenLanguage`);
 *  - ids are seeded, never generated: the same beats file must produce the same
 *    artefact key on every machine, forever.
 */

/**
 * The deliverable shapes. One beats file drives all of them.
 *
 * `1:1` exists because references arrive square: the owner's own reference video is
 * 720x720, and before this it was forced to 9:16, which CROPPED the sides of their footage
 * rather than showing it. A square deliverable is also the shape most feeds show uncropped.
 */
export type AspectRatio = '9:16' | '16:9' | '1:1';

/**
 * How a scene draws its beats. This is the only place the emitter's vocabulary is
 * defined, and every kind is industry-neutral: a listing, a course, a visa
 * service and a machine-tool catalogue all read the same way.
 */
export type SceneKind =
  /** Big two-line opening statement over a moving plate. */
  | 'hook'
  /** One line per beat, each replacing the last (a range, a set of types). */
  | 'beat'
  /** Beats accumulate as rows (a roll call of places, features, options). */
  | 'list'
  /** A flat card with one row per beat (what to send us, what is included). */
  | 'info'
  /** Call to action lines with rules under them. */
  | 'cta'
  /** Plaques: the end-card numbers, or a beat's own numerals. */
  | 'numbers'
  /** The brand card. Always last, always still at the end. */
  | 'endcard';

export const SCENE_KINDS: readonly SceneKind[] = [
  'hook',
  'beat',
  'list',
  'info',
  'cta',
  'numbers',
  'endcard',
];

/** Where a plate's pixels come from. Never YouTube, never a customer's phone. */
export type PlateSource =
  /** An asset already in R2 / the brand kit: `key` names it. */
  | 'asset'
  /** Generated motion (kie image-to-video / text-to-video): `prompt` + `seconds`. */
  | 'generate';

export interface PlateSpec {
  /** Stable id referenced by beats and scenes, e.g. `hook-a`. */
  id: string;
  source: PlateSource;
  /** `asset`: the R2 key (or project-relative path) of the source mp4. */
  key?: string;
  /** `generate`: the motion prompt. One slow move, no cuts, no text. */
  prompt?: string;
  /** `generate`: clip length in seconds (registry note: keep at or under 6 s). */
  seconds?: number;
  /** Seconds into the source where this usage starts. Defaults per usage index. */
  mediaStart?: number;
}

export interface Beat {
  /** Stable, seeded id — `p01`, `p02`, … Used as the audio file name. */
  id: string;
  /**
   * What the voice says. Hinglish by default; written to be spoken, not read.
   * Empty only for a beat that is carried by picture alone.
   */
  vo: string;
  /** On-screen lines, one reveal each. English, short, ≤ MAX_LINE_WORDS words. */
  lines: string[];
  /** Small uppercase kicker above the lines, e.g. `TRICITY · PUNJAB`. */
  label?: string;
  /** Plate this beat shows. Falls back to its scene's plate. */
  plate?: string;
}

export interface SceneSpec {
  /** `s1`, `s2`, … (`s0` is reserved for the 0.5 s plate-only lead-in). */
  id: string;
  kind: SceneKind;
  /** Beat ids, in reveal order. Empty for a silent (picture-only) scene. */
  beats: string[];
  /** Plate for the whole scene when the beats do not each name one. */
  plate?: string;
  /** Required for a silent scene: its fixed length in seconds. */
  dur?: number;
}

export interface VoiceDirection {
  /** Language the voice SPEAKS. Hinglish default; never changes the on-screen copy. */
  language: string;
  /** kie.ai voice name; the id comes from the registry (MEDIA_MODELS.voice.id). */
  speaker: string;
  /**
   * Sound-design direction. This is where delivery goes — a non-empty per-speaker
   * `style` is rejected with HTTP 422, so direction lives here.
   */
  scene: string;
  sampleContext?: string;
}

export interface EndCardFields {
  /** Business name, as it should appear. */
  name: string;
  /** English tagline under the wordmark. */
  tagline: string;
  /** Exactly two numbers. They are the hero objects of the last beats. */
  numbers: string[];
  /** Office / contact address, one or two lines. */
  address: string[];
  /** Optional closing pledge line. */
  pledge?: string;
  /**
   * Optional logo, project-relative (`assets/brand/logo.png`). Without one the
   * name is set as a wordmark in type — which is deliberately the default, because
   * a keyed or badly-cropped logo plate looks worse than clean type.
   */
  logo?: string;
}

export interface Beats {
  /** Schema version. 1 is the only one this module accepts. */
  version: 1;
  /**
   * Seeded job id: lowercase, no spaces. It names the sandbox work dir and the R2
   * prefix, so the same id must never be reused for a different film.
   */
  jobId: string;
  aspect: AspectRatio;
  fps: number;
  /** Declared floor for the finished film. Must be ≥ MIN_TARGET_SECONDS. */
  targetSeconds: number;
  /** Language the viewer READS. `en` unless the caller asked otherwise. */
  onScreenLanguage: string;
  logoOnScreen: boolean;
  voice: VoiceDirection;
  endCard: EndCardFields;
  plates: PlateSpec[];
  beats: Beat[];
  scenes: SceneSpec[];
}

/** A film shorter than this is not a film. */
export const MIN_TARGET_SECONDS = 30;

/** The renderer only emits MP4 at these rates; anything else fails at render time. */
export const SUPPORTED_FPS: readonly number[] = [24, 25, 30];

/**
 * Words per on-screen line. 9:16 is the tight one: five words at 128 px fills the
 * 948 px usable width, so a sixth word either clips or shrinks below legible.
 */
export const MAX_LINE_WORDS: Record<AspectRatio, number> = { '9:16': 5, '16:9': 9, '1:1': 7 };

/**
 * The lead-in. A scene that is on screen at t = 0 never reveals its non-media
 * `.clip` overlays (HyperFrames marks them hidden on the first pass and never
 * unhides them), so every film opens on a 0.5 s plate-only scene and the hook
 * becomes a LATER scene. timing.ts owns the number; beats.ts re-exports it so a
 * plan can be reasoned about in one file.
 */
export const LEAD_IN_SECONDS = 0.5;

/** Readable type needs this long on screen, minimum. Trap 5 of the reference. */
export function minHoldSeconds(words: number): number {
  return roundTo(0.5 + 0.3 * Math.max(1, words), 3);
}

/** Deterministic rounding — the only floating-point discipline in the pipeline. */
export function roundTo(value: number, dp = 3): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

export class BeatsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BeatsError';
    Object.setPrototypeOf(this, BeatsError.prototype);
  }
}

function fail(path: string, why: string): never {
  throw new BeatsError(`beats.json: ${path} ${why}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Collapse runs of whitespace; a line that wrapped in the JSON is still one line. */
function words(text: string): string[] {
  return String(text).trim().split(/\s+/).filter(Boolean);
}

function line(text: unknown, path: string): string {
  if (typeof text !== 'string' || !text.trim()) fail(path, 'must be a non-empty string');
  return words(text as string).join(' ');
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return line(value, path);
}

/** Latin copy only: an English card with one stray Devanagari word looks broken. */
const LATIN_TEXT = /^[\t\n\r\x20-\x7e\u00a0-\u024f\u2010-\u2027\u2030-\u205e\u20ac\u2190-\u21ff\u2600-\u27bf]*$/;

const JOB_ID = /^[a-z0-9][a-z0-9._-]{1,63}$/;

/**
 * Validate and normalise a beats file.
 *
 * Returns a frozen, fully-defaulted object or throws `BeatsError` naming the exact
 * path that is wrong. This runs BEFORE any spend, which is the whole point: a
 * sixth word on a 9:16 line or a 20 s target is free to discover here and
 * expensive to discover in a rendered frame.
 */
export function parseBeats(raw: unknown): Beats {
  if (!isObject(raw)) fail('(root)', 'must be a JSON object');

  if (raw.version !== 1) fail('version', `must be 1 (got ${JSON.stringify(raw.version)})`);

  const jobId = typeof raw.jobId === 'string' ? raw.jobId.trim() : '';
  if (!JOB_ID.test(jobId)) {
    fail(
      'jobId',
      'must be a seeded lowercase id (2-64 chars, [a-z0-9._-], starting alphanumeric) — ' +
        'it names the sandbox dir and the R2 prefix, so it may not be generated at runtime',
    );
  }

  const aspectRaw = String(raw.aspect ?? '');
  const ASPECTS = ['9:16', '16:9', '1:1'] as const;
  const aspect = aspectRaw as AspectRatio;
  if (!(ASPECTS as readonly string[]).includes(aspectRaw)) {
    fail('aspect', `must be one of ${ASPECTS.map((entry) => `"${entry}"`).join(', ')} (got ${JSON.stringify(raw.aspect)})`);
  }

  const fpsRaw = raw.fps === undefined ? 30 : Number(raw.fps);
  if (!SUPPORTED_FPS.includes(fpsRaw)) {
    fail('fps', `must be one of ${SUPPORTED_FPS.join(', ')} (got ${JSON.stringify(raw.fps)})`);
  }

  const targetSeconds = Number(raw.targetSeconds ?? MIN_TARGET_SECONDS);
  if (!Number.isFinite(targetSeconds) || targetSeconds < MIN_TARGET_SECONDS) {
    fail(
      'targetSeconds',
      `must be a number ≥ ${MIN_TARGET_SECONDS} (got ${JSON.stringify(raw.targetSeconds)}). ` +
        'A film under 30 s is not a film; cut beats first, then re-plan.',
    );
  }

  const onScreenLanguage = String(raw.onScreenLanguage ?? 'en').trim().toLowerCase() || 'en';

  const voiceRaw = raw.voice;
  if (!isObject(voiceRaw)) fail('voice', 'must be an object with at least { language, scene }');
  const voice: VoiceDirection = {
    language: line(voiceRaw.language ?? 'hinglish', 'voice.language').toLowerCase(),
    speaker: optionalString(voiceRaw.speaker, 'voice.speaker') ?? 'Charon',
    scene: line(voiceRaw.scene, 'voice.scene'),
    ...(optionalString(voiceRaw.sampleContext, 'voice.sampleContext')
      ? { sampleContext: optionalString(voiceRaw.sampleContext, 'voice.sampleContext') }
      : {}),
  };

  const cardRaw = raw.endCard;
  if (!isObject(cardRaw)) fail('endCard', 'must be an object');
  const numbers = Array.isArray(cardRaw.numbers) ? cardRaw.numbers : [];
  if (numbers.length !== 2) {
    fail('endCard.numbers', `must hold exactly two numbers (got ${numbers.length})`);
  }
  const address = Array.isArray(cardRaw.address) ? cardRaw.address : [];
  if (address.length < 1 || address.length > 2) {
    fail('endCard.address', `must hold one or two lines (got ${address.length})`);
  }
  const endCard: EndCardFields = {
    name: line(cardRaw.name, 'endCard.name'),
    tagline: line(cardRaw.tagline, 'endCard.tagline'),
    numbers: numbers.map((n, i) => {
      const text = line(n, `endCard.numbers[${i}]`);
      if (!/^[+(\d][\d\s()+-]{5,}$/.test(text)) {
        fail(`endCard.numbers[${i}]`, `does not look like a phone number (got "${text}")`);
      }
      return text;
    }),
    address: address.map((a, i) => line(a, `endCard.address[${i}]`)),
    ...(optionalString(cardRaw.pledge, 'endCard.pledge')
      ? { pledge: optionalString(cardRaw.pledge, 'endCard.pledge') }
      : {}),
    ...(optionalString(cardRaw.logo, 'endCard.logo')
      ? { logo: optionalString(cardRaw.logo, 'endCard.logo') }
      : {}),
  };

  const platesRaw = raw.plates;
  if (!Array.isArray(platesRaw) || platesRaw.length === 0) {
    fail('plates', 'must be a non-empty array');
  }
  const plateIds = new Set<string>();
  const plates: PlateSpec[] = platesRaw.map((entry, i) => {
    if (!isObject(entry)) fail(`plates[${i}]`, 'must be an object');
    const id = line(entry.id, `plates[${i}].id`);
    if (plateIds.has(id)) fail(`plates[${i}].id`, `duplicates plate "${id}"`);
    plateIds.add(id);

    const source = String(entry.source ?? '');
    if (source !== 'asset' && source !== 'generate') {
      fail(`plates[${i}].source`, 'must be "asset" or "generate"');
    }

    if (source === 'asset') {
      line(entry.key, `plates[${i}].key`);
    } else {
      line(entry.prompt, `plates[${i}].prompt`);
      const seconds = Number(entry.seconds ?? 6);
      if (!Number.isFinite(seconds) || seconds < 1 || seconds > 6) {
        fail(
          `plates[${i}].seconds`,
          `must be 1-6 (got ${JSON.stringify(entry.seconds)}): the video model is billed per ` +
            'second and the registry keeps clips at or under 6 s',
        );
      }
    }

    const mediaStart = entry.mediaStart === undefined ? undefined : Number(entry.mediaStart);
    if (mediaStart !== undefined && (!Number.isFinite(mediaStart) || mediaStart < 0)) {
      fail(`plates[${i}].mediaStart`, 'must be a number ≥ 0');
    }

    return {
      id,
      source: source as PlateSource,
      ...(source === 'asset' ? { key: line(entry.key, `plates[${i}].key`) } : {}),
      ...(source === 'generate'
        ? {
            prompt: line(entry.prompt, `plates[${i}].prompt`),
            seconds: roundTo(Number(entry.seconds ?? 6), 2),
          }
        : {}),
      ...(mediaStart !== undefined ? { mediaStart: roundTo(mediaStart, 3) } : {}),
    };
  });
  const plateById = new Map(plates.map((p) => [p.id, p]));

  const maxWords = MAX_LINE_WORDS[aspect];

  const beatsRaw = raw.beats;
  if (!Array.isArray(beatsRaw) || beatsRaw.length === 0) {
    fail('beats', 'must be a non-empty array');
  }
  const beatIds = new Set<string>();
  const beats: Beat[] = beatsRaw.map((entry, i) => {
    if (!isObject(entry)) fail(`beats[${i}]`, 'must be an object');
    const id = line(entry.id, `beats[${i}].id`);
    if (!/^[a-z][a-z0-9_-]{0,23}$/.test(id)) {
      fail(`beats[${i}].id`, `must be a short seeded id like "p01" (got "${id}")`);
    }
    if (beatIds.has(id)) fail(`beats[${i}].id`, `duplicates beat "${id}"`);
    beatIds.add(id);

    const vo = typeof entry.vo === 'string' ? words(entry.vo).join(' ') : '';

    const linesRaw = entry.lines;
    if (!Array.isArray(linesRaw) || linesRaw.length === 0) {
      fail(`beats[${i}].lines`, 'must be a non-empty array of on-screen lines');
    }
    if (linesRaw.length > 3) {
      fail(
        `beats[${i}].lines`,
        `holds ${linesRaw.length} lines; three is the maximum a beat can reveal inside its own window`,
      );
    }
    const lines = linesRaw.map((text, j) => {
      const value = line(text, `beats[${i}].lines[${j}]`);
      const count = words(value).length;
      if (count > maxWords) {
        fail(
          `beats[${i}].lines[${j}]`,
          `is ${count} words ("${value}"); at ${aspect} a line may be at most ${maxWords}. ` +
            'Shorten it or split it across two beats.',
        );
      }
      if (onScreenLanguage === 'en' && !LATIN_TEXT.test(value)) {
        fail(
          `beats[${i}].lines[${j}]`,
          `is not Latin script ("${value}") but onScreenLanguage is "en". ` +
            'On-screen copy is English unless the plan explicitly asks for another language.',
        );
      }
      return value;
    });

    const label = optionalString(entry.label, `beats[${i}].label`);
    if (label && words(label).length > 5) {
      fail(`beats[${i}].label`, `is ${words(label).length} words; a kicker may be at most 5`);
    }

    const plate = optionalString(entry.plate, `beats[${i}].plate`);
    if (plate && !plateById.has(plate)) {
      fail(`beats[${i}].plate`, `names plate "${plate}" which is not in plates[]`);
    }

    return { id, vo, lines, ...(label ? { label } : {}), ...(plate ? { plate } : {}) };
  });

  const scenesRaw = raw.scenes;
  if (!Array.isArray(scenesRaw) || scenesRaw.length === 0) {
    fail('scenes', 'must be a non-empty array');
  }
  const beatById = new Map(beats.map((b) => [b.id, b]));
  const sceneIds = new Set<string>();
  const seenBeats = new Set<string>();
  const scenes: SceneSpec[] = scenesRaw.map((entry, i) => {
    if (!isObject(entry)) fail(`scenes[${i}]`, 'must be an object');
    const id = line(entry.id, `scenes[${i}].id`);
    if (!/^s[1-9][0-9]?$/.test(id)) {
      fail(
        `scenes[${i}].id`,
        `must look like "s1".."s99" (got "${id}"); "s0" belongs to the 0.5 s lead-in`,
      );
    }
    if (sceneIds.has(id)) fail(`scenes[${i}].id`, `duplicates scene "${id}"`);
    sceneIds.add(id);

    const kind = String(entry.kind ?? '');
    if (!SCENE_KINDS.includes(kind as SceneKind)) {
      fail(`scenes[${i}].kind`, `must be one of ${SCENE_KINDS.join(' | ')}`);
    }

    const beatsList = Array.isArray(entry.beats) ? entry.beats : [];
    const sceneBeats = beatsList.map((value, j) => {
      const beatId = line(value, `scenes[${i}].beats[${j}]`);
      if (!beatIds.has(beatId)) {
        fail(`scenes[${i}].beats[${j}]`, `names beat "${beatId}" which is not in beats[]`);
      }
      if (seenBeats.has(beatId)) {
        fail(`scenes[${i}].beats[${j}]`, `beat "${beatId}" already belongs to another scene`);
      }
      seenBeats.add(beatId);
      return beatId;
    });

    const plate = optionalString(entry.plate, `scenes[${i}].plate`);
    if (plate && !plateById.has(plate)) {
      fail(`scenes[${i}].plate`, `names plate "${plate}" which is not in plates[]`);
    }

    if (sceneBeats.length === 0) {
      const dur = Number(entry.dur);
      if (!Number.isFinite(dur) || dur < 0.5 || dur > 12) {
        fail(
          `scenes[${i}].dur`,
          'is required (0.5-12 s) for a silent scene — with no voice line there is nothing to measure',
        );
      }
      if (!plate) {
        fail(`scenes[${i}].plate`, 'is required for a silent scene (nothing else would fill the frame)');
      }
      return { id, kind: kind as SceneKind, beats: [], plate, dur: roundTo(dur, 3) };
    }

    const beatPlate = sceneBeats.some((id) => Boolean(beatById.get(id)?.plate));
    if (!plate && !beatPlate) {
      fail(
        `scenes[${i}]`,
        'has neither plate nor any beat with a plate: nothing would fill the frame. ' +
          'Name a plate on the scene (or on each of its beats).',
      );
    }

    return { id, kind: kind as SceneKind, beats: sceneBeats, ...(plate ? { plate } : {}) };
  });

  const orphan = beats.filter((b) => !seenBeats.has(b.id));
  if (orphan.length) {
    fail(
      'scenes',
      `leave beat(s) ${orphan.map((b) => b.id).join(', ')} unplaced. Every beat belongs to ` +
        'exactly one scene — an unplaced beat is paid for and never heard.',
    );
  }

  const last = scenes[scenes.length - 1];
  if (last.kind !== 'endcard') {
    fail('scenes', `must end with an "endcard" scene (last is "${last.id}", kind "${last.kind}")`);
  }
  if (scenes.filter((s) => s.kind === 'endcard').length > 1) {
    fail('scenes', 'may hold only one "endcard" scene');
  }

  return {
    version: 1,
    jobId,
    aspect,
    fps: fpsRaw,
    targetSeconds: roundTo(targetSeconds, 3),
    onScreenLanguage,
    logoOnScreen: raw.logoOnScreen === undefined ? true : Boolean(raw.logoOnScreen),
    voice,
    endCard,
    plates,
    beats,
    scenes,
  };
}

/** Beats that carry a spoken line — the ones that cost voice credits. */
export function speakableBeats(beats: Beats): Beat[] {
  return beats.beats.filter((b) => b.vo.length > 0);
}

/** The beats of one scene, in reveal order. */
export function sceneBeats(beats: Beats, scene: SceneSpec): Beat[] {
  const byId = new Map(beats.beats.map((b) => [b.id, b]));
  return scene.beats.map((id) => byId.get(id)).filter((b): b is Beat => Boolean(b));
}

/** Which plate a beat shows, falling back to its scene's. */
export function plateFor(beats: Beats, scene: SceneSpec, beat: Beat | null): PlateSpec | undefined {
  const id = beat?.plate ?? scene.plate ?? sceneBeats(beats, scene)[0]?.plate;
  return id ? beats.plates.find((p) => p.id === id) : undefined;
}

/** Every on-screen line with the beat and scene it belongs to. */
export function onScreenLines(
  beats: Beats,
): { scene: SceneSpec; beat: Beat; text: string; words: number }[] {
  const out: { scene: SceneSpec; beat: Beat; text: string; words: number }[] = [];
  for (const scene of beats.scenes) {
    for (const beat of sceneBeats(beats, scene)) {
      for (const text of beat.lines) {
        out.push({ scene, beat, text, words: words(text).length });
      }
    }
  }
  return out;
}

/**
 * A stable 8-hex-digit fingerprint of the plan.
 *
 * Used for the artefact key (`video/<jobId>-<seed>/final.mp4`) so the same beats
 * file always names the same output and a changed plan always names a new one.
 * FNV-1a over the canonical JSON: no crypto import, no clock, no randomness.
 */
export function beatsSeed(beats: Beats): string {
  const text = canonicalBeats(beats);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Key-sorted JSON, so the seed cannot depend on property order. */
export function canonicalBeats(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === 'object') {
      const source = input as Record<string, unknown>;
      return Object.keys(source)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = sort(source[key]);
          return acc;
        }, {});
    }
    return input;
  };
  return JSON.stringify(sort(value));
}

/** One line for the log and the plan the user is shown. */
export function describeBeats(beats: Beats): string {
  const spoken = speakableBeats(beats);
  const lines = onScreenLines(beats).length;
  return (
    `${beats.jobId} · ${beats.aspect} ${beats.fps}fps · ${beats.scenes.length} scenes · ` +
    `${spoken.length} voice lines · ${lines} on-screen lines · voice ${beats.voice.language} ` +
    `· copy ${beats.onScreenLanguage}`
  );
}
