/**
 * The `video` skill: beats.json -> measured timing -> HyperFrames project ->
 * render -> R2, with the artefact key recorded on `agent_runs`.
 *
 * WHAT THIS FILE IS, AND IS NOT
 *   - It is the ENTRY POINT of the skill and the only part that touches the
 *     outside world. `beats.ts`, `timing.ts` and `emit.ts` are pure; this one
 *     calls kie.ai for voice and motion, drives `lib/agent/sandbox/pipeline.ts`
 *     for the durable three-step run, and publishes to R2.
 *   - It is NOT a second runner. The steps, the checkpointing, the per-step
 *     charge, the idle pause and the soft cap all come from
 *     `runVideoPipeline`; this file supplies each step's BODY through
 *     `VideoJobSpec.run`, plus honest artefact keys.
 *
 * THE ORDER THAT KEEPS THE MONEY SAFE
 *
 *     planVideoSkill(input)   pure maths, registry prices, no spend  -> the user
 *     runVideoSkill(...)      reserves, then spends step by step     -> the film
 *
 * A run is resumable: every step checkpoints into `agent_runs.completed`, and a
 * completed step is never re-run or re-charged. The voiceover step measures what
 * the voice ACTUALLY did (ffmpeg `silencedetect` + `ffprobe`) and writes the
 * measurement to R2, so a resumed run does not have to pay for the voice again to
 * find out how long it was.
 *
 * Nothing here runs at import time: no adapters, no env, no network.
 */

import {
  assertKnownModel,
  estimateCredits,
  MEDIA_MODELS,
  videoCredits,
  withMediaFallback,
} from '../../../media-models';
import {
  describeBeats,
  MAX_LINE_WORDS,
  minHoldSeconds,
  parseBeats,
  roundTo,
  sceneBeats,
  speakableBeats,
  type AspectRatio,
  type Beats,
  type EndCardFields,
} from './beats';
import { measureVoiceover, timingJsonText, type Timing, type VoOnset } from './timing';
import { emitProject, projectSlug, PROJECT_CLI_VERSION, type EmittedProject } from './emit';
import { RENDER_CREDITS } from '../../../sandbox/pipeline';
import type { VideoStepName } from '../../../sandbox/pipeline';
import { detailOf, isExecutableSandbox, shellQuote, type AgentSandbox } from '../../../sandbox/e2b';
import { consoleLogger, type AgentLogger } from '../../../sandbox/log';
import type { SandboxLike, StepContext } from '../../../sandbox/runner';

/** The registry ids this skill is allowed to spend money on. */
export const VOICE_MODEL = assertKnownModel(MEDIA_MODELS.voice.id);
export const CLIP_MODEL = assertKnownModel(MEDIA_MODELS.video.id);

/** R2 key of the finished film: `<prefix>/final.mp4`. */
export function artefactKeyFor(beats: Beats): string {
  return `video/${projectSlug(beats)}/final.mp4`;
}

/** R2 key of the measured voice, and of the emitted project manifest. */
export function voiceArtefactKeyFor(beats: Beats): string {
  return `video/${projectSlug(beats)}/voiceover.json`;
}
export function projectArtefactKeyFor(beats: Beats): string {
  return `video/${projectSlug(beats)}/project.json`;
}

// ────────────────────────────────────────────────────────────────────────────
// Input
// ────────────────────────────────────────────────────────────────────────────

/**
 * What a caller may ask for. Everything here is an OVERRIDE on the beats file:
 * one beats.json drives both aspects, and the caller picks the rest per delivery.
 */
export interface VideoSkillInput {
  /** The beats file: raw JSON (validated) or an already-parsed plan. */
  beats: unknown | Beats;
  /** `9:16` or `16:9`. Defaults to what the beats file declares. */
  aspect?: AspectRatio;
  /** Language the voice SPEAKS. Hinglish is the default. */
  voiceLanguage?: string;
  /** Language the viewer READS. English unless the caller explicitly asks. */
  onScreenLanguage?: string;
  /** Declared floor for the finished film. Never below 30 s. */
  targetSeconds?: number;
  /** Keep the brand bug on screen for the whole film (it never covers the end card). */
  logoOnScreen?: boolean;
  /** End-card fields: name, tagline, the two numbers, the address, an optional pledge. */
  endCard?: Partial<EndCardFields>;
}

function isParsed(value: unknown): value is Beats {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Beats).version === 1 &&
    Array.isArray((value as Beats).scenes) &&
    Array.isArray((value as Beats).plates)
  );
}

/**
 * Apply the caller's overrides on top of the beats file, then validate.
 *
 * On-screen copy is English by default; a caller that asks for another language
 * has to say so, because the Latin-script guard in `parseBeats` would otherwise
 * reject (or, worse, silently accept) a mismatched card.
 */
export function resolveBeats(input: VideoSkillInput): Beats {
  if (typeof input !== 'object' || input === null) {
    throw new Error('[video-skill] needs { beats }');
  }

  // A fresh object every time: an override must never mutate the caller's plan.
  const source: Record<string, unknown> = isParsed(input.beats)
    ? (JSON.parse(JSON.stringify(input.beats)) as Record<string, unknown>)
    : { ...(input.beats as Record<string, unknown>) };

  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('[video-skill] beats must be an object');
  }

  if (input.aspect) source.aspect = input.aspect;
  if (input.voiceLanguage) {
    const voice = (source.voice ?? {}) as Record<string, unknown>;
    source.voice = { ...voice, language: input.voiceLanguage };
  }
  if (input.onScreenLanguage) source.onScreenLanguage = input.onScreenLanguage;
  if (input.targetSeconds !== undefined) source.targetSeconds = input.targetSeconds;
  if (input.logoOnScreen !== undefined) source.logoOnScreen = input.logoOnScreen;
  if (input.endCard) {
    const card = (source.endCard ?? {}) as Record<string, unknown>;
    source.endCard = { ...card, ...stripUndefined(input.endCard) };
  }

  return parseBeats(source);
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined && entry !== null) (out as Record<string, unknown>)[key] = entry;
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// The plan (pure, before any spend)
// ────────────────────────────────────────────────────────────────────────────

export interface CreditLine {
  /** Registry model id, or `render` for sandbox compute. */
  media: string;
  credits: number;
  detail: string;
}

export interface CreditEstimate {
  voice: number;
  clips: number;
  render: number;
  total: number;
  lines: CreditLine[];
}

export interface VideoSkillPlan {
  beats: Beats;
  /** One line for the log and for the user who is about to pay. */
  briefing: string;
  slug: string;
  /** R2 key the finished film will be published to. */
  artefactKey: string;
  steps: { name: VideoStepName; credits: number; artefact: string }[];
  credits: CreditEstimate;
  /** Seconds of generated motion the plan will buy. */
  clipSeconds: number;
  voiceLines: number;
  generatedPlates: string[];
  assetPlates: string[];
  notes: string[];
}

/**
 * Credits for one plan, straight from the registry.
 *
 * No price is written here: voice is `estimateCredits('voice', lines)` (2 credits
 * per request in MEDIA_MODELS.voice), motion is `videoCredits(seconds)` (8
 * credits/second for Grok Imagine 1080p), and the render charge is the pipeline's
 * own `RENDER_CREDITS`. Change a price in media-models.ts and this follows.
 */
export function estimateVideoCredits(beats: Beats, renderCredits = RENDER_CREDITS): CreditEstimate {
  const lines = speakableBeats(beats);
  const generated = beats.plates.filter((plate) => plate.source === 'generate');
  const clipSeconds = roundTo(
    generated.reduce((sum, plate) => sum + (plate.seconds ?? 6), 0),
    3,
  );

  const voice = estimateCredits('voice', lines.length);
  const clips = clipSeconds > 0 ? videoCredits(clipSeconds) : 0;
  const render = renderCredits;

  const breakdown: CreditLine[] = [
    {
      media: VOICE_MODEL,
      credits: voice,
      detail: `${lines.length} line(s) x ${estimateCredits('voice', 1)} credits`,
    },
    {
      media: CLIP_MODEL,
      credits: clips,
      detail: `${clipSeconds}s of generated motion (${generated.length} plate(s))`,
    },
    {
      media: 'render',
      credits: render,
      detail: 'sandbox compute for the HyperFrames render',
    },
  ];

  return {
    voice,
    clips,
    render,
    total: voice + clips + render,
    lines: breakdown,
  };
}

/**
 * The plan the caller sees BEFORE anything is spent.
 *
 * Pure: no network, no sandbox, no Supabase. It prices the work from the registry,
 * names the exact R2 key the film will land on, and lists the steps the durable
 * runner will execute (in order, with the credits each one charges).
 */
export function planVideoSkill(input: VideoSkillInput, options: { renderCredits?: number } = {}): VideoSkillPlan {
  const beats = resolveBeats(input);
  const slug = projectSlug(beats);
  const credits = estimateVideoCredits(beats, options.renderCredits ?? RENDER_CREDITS);
  const generated = beats.plates.filter((p) => p.source === 'generate').map((p) => p.id);
  const asset = beats.plates.filter((p) => p.source === 'asset').map((p) => p.id);

  const notes: string[] = [];
  if (beats.logoOnScreen && !beats.endCard.logo) {
    notes.push(
      'logoOnScreen is on but endCard.logo names no file: the brand bug is omitted and the end ' +
        'card sets the name in type, because an <img> with no file is a 404 at render time',
    );
  }
  const tightest = tightestLine(beats);
  if (tightest) {
    notes.push(
      `tightest on-screen line: "${tightest.text}" — ${tightest.words} word(s) need ` +
        `${minHoldSeconds(tightest.words)}s on screen`,
    );
  }
  if (beats.targetSeconds > 60) {
    notes.push(
      `target ${beats.targetSeconds}s is long for one pass; the film is cut from the measured voice, ` +
        'so a fast read lands shorter and the end card holds the difference',
    );
  }
  if (generated.length > 0) {
    notes.push(
      `${generated.length} generated plate(s) at ${beats.plates
        .filter((p) => p.source === 'generate')
        .map((p) => `${p.id}:${p.seconds}s`)
        .join(', ')} — the video registry keeps clips at or under 6 s`,
    );
  }

  return {
    beats,
    briefing: describeBeats(beats),
    slug,
    artefactKey: artefactKeyFor(beats),
    steps: [
      { name: 'voiceover', credits: credits.voice, artefact: voiceArtefactKeyFor(beats) },
      { name: 'clips', credits: credits.clips, artefact: projectArtefactKeyFor(beats) },
      { name: 'render', credits: credits.render, artefact: artefactKeyFor(beats) },
    ],
    credits,
    clipSeconds: roundTo(
      beats.plates
        .filter((p) => p.source === 'generate')
        .reduce((sum, p) => sum + (p.seconds ?? 6), 0),
      3,
    ),
    voiceLines: speakableBeats(beats).length,
    generatedPlates: generated,
    assetPlates: asset,
    notes,
  };
}

function tightestLine(beats: Beats): { text: string; words: number } | null {
  let best: { text: string; words: number } | null = null;
  for (const beat of beats.beats) {
    for (const text of beat.lines) {
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      if (!best || words > best.words) best = { text, words };
    }
  }
  return best;
}

/** Convenience: the aspect's word ceiling, re-exported for callers building a beats file. */
export { MAX_LINE_WORDS };

// ────────────────────────────────────────────────────────────────────────────
// Measurement helpers (pure, so the maths is testable without ffmpeg)
// ────────────────────────────────────────────────────────────────────────────

export interface SilenceSpan {
  /** seconds */
  start: number;
  end: number;
}

/**
 * Parse `ffmpeg -af silencedetect=noise=-35dB:d=0.10 …` stderr.
 *
 * ffmpeg writes `[silencedetect @ …] silence_start: 1.23` and `silence_end: 2.34
 * | silence_duration: 1.11`. A silence that runs to EOF has no `silence_end`.
 */
export function parseSilenceDetect(text: string): SilenceSpan[] {
  const spans: { start: number; end?: number }[] = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const start = raw.match(/silence_start:\s*(-?[\d.]+)/);
    if (start) {
      spans.push({ start: Math.max(0, Number(start[1])) });
      continue;
    }
    const end = raw.match(/silence_end:\s*(-?[\d.]+)/);
    if (end && spans.length && spans[spans.length - 1].end === undefined) {
      spans[spans.length - 1].end = Math.max(0, Number(end[1]));
    }
  }
  return spans.map((span) => ({ start: roundTo(span.start, 3), end: roundTo(span.end ?? span.start, 3) }));
}

/**
 * Turn one line's ffmpeg measurement into the onset `timing.ts` wants.
 *
 * `total` is the raw wav duration, `silences` what silencedetect found. Each line
 * is measured in its OWN file, so its position in the assembled track is 0 once the
 * leading silence has been trimmed — that measurement goes in `lead`, and the
 * speech between lead and tail in `dur`. Passing the lead as `start` instead would
 * make every line claim to begin at 0.4 s, which is exactly the kind of quiet lie
 * that puts the picture 27 s away from the voice.
 */
export function onsetFromMeasurement(
  id: string,
  total: number,
  silences: readonly SilenceSpan[],
): VoOnset {
  const lead = silences.find((span) => span.start <= 0.001)?.end ?? 0;
  const tail = [...silences].reverse().find((span) => span.end >= total - 0.001);
  const end = tail ? tail.start : total;
  const speech = roundTo(Math.max(0.05, end - lead), 3);
  return { id, start: 0, dur: speech, lead: roundTo(lead, 3) };
}

/** The scene plan `measureVoiceover` needs, derived from validated beats. */
export function scenePlanFor(beats: Beats): { scene: Beats['scenes'][number]; beatIds: string[] }[] {
  const spoken = new Set(speakableBeats(beats).map((b) => b.id));
  return beats.scenes.map((scene) => ({
    scene,
    beatIds: sceneBeats(beats, scene)
      .filter((beat) => spoken.has(beat.id))
      .map((beat) => beat.id),
  }));
}

/** Measure + emit, in one pure call. This is what the two sandbox steps share. */
export function buildProject(
  beats: Beats,
  onsets: readonly VoOnset[],
): { timing: Timing; project: EmittedProject } {
  const timing = measureVoiceover(onsets, scenePlanFor(beats), {
    minTotal: Math.max(beats.targetSeconds, 30),
  });
  const project = emitProject(beats, timing);
  return { timing, project };
}

// ────────────────────────────────────────────────────────────────────────────
// Host-side seams (all injectable; the defaults are the real vendors)
// ────────────────────────────────────────────────────────────────────────────

export interface VoiceRequest {
  id: string;
  text: string;
  language: string;
  speaker: string;
  scene: string;
  sampleContext?: string;
  model: string;
}

export interface ClipRequest {
  plate: string;
  prompt: string;
  seconds: number;
  aspect: AspectRatio;
  model: string;
}

export interface UploadResult {
  url: string;
  bytes: number;
}

/** Where the finished film is recorded. */
export interface RunArtefact {
  key: string;
  url: string;
  seconds: number;
  bytes: number;
  fps: number;
  aspect: AspectRatio;
  slug: string;
  jobId: string;
  /** `check --json` summary from the render step. */
  check: { errors: number; warnings: number } | null;
}

export interface RecordResult {
  recorded: boolean;
  reason: string | null;
}

export interface VideoSkillDeps {
  /** Render one voice line. Default: the registry's voice model (MEDIA_MODELS.voice.id) via createGeminiTTS. */
  tts?: (request: VoiceRequest) => Promise<Uint8Array | { path: string }>;
  /** Render one motion plate. Default: the registry's video model (MEDIA_MODELS.video.id). */
  clip?: (request: ClipRequest) => Promise<Uint8Array | { path: string }>;
  /** Load a supplied plate (`asset` source): an https URL or an R2 key. */
  loadAsset?: (key: string) => Promise<Uint8Array>;
  /** Read an earlier step's artefact back (so a resumed run need not re-measure). */
  readArtefact?: (key: string) => Promise<string | null>;
  /** Push a file from the sandbox to R2 and return its public URL. */
  publish?: (args: {
    sandbox: AgentSandbox;
    sandboxPath: string;
    key: string;
    contentType: string;
  }) => Promise<UploadResult>;
  /** Record the published key on the run row. Default: UPDATE agent_runs. */
  record?: (runId: string, artefact: RunArtefact) => Promise<RecordResult>;
  log?: AgentLogger;
}

// ────────────────────────────────────────────────────────────────────────────
// Sandbox helpers
// ────────────────────────────────────────────────────────────────────────────

function sandboxOf(sandbox: SandboxLike, step: string): AgentSandbox {
  if (!isExecutableSandbox(sandbox)) {
    throw new Error(`[video-skill] step ${step}: sandbox ${sandbox.id} cannot execute commands`);
  }
  return sandbox;
}

/** Write bytes into the sandbox: base64 over `files.write`, decoded with coreutils. */
async function writeBytes(sandbox: AgentSandbox, path: string, bytes: Uint8Array): Promise<void> {
  const b64 = Buffer.from(bytes).toString('base64');
  const staging = `${path}.b64`;
  await sandbox.writeFile(staging, b64);
  await sandbox.exec(`mkdir -p ${shellQuote(dirOf(path))} && base64 -d ${shellQuote(staging)} > ${shellQuote(path)} && rm -f ${shellQuote(staging)}`);
}

function dirOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut <= 0 ? '.' : path.slice(0, cut);
}

/**
 * The three ffmpeg invocations the voice step depends on, as DATA.
 *
 * They are exported so an acceptance harness can run the identical commands
 * outside the sandbox — a measurement proved by a different command line is not a
 * measurement of this pipeline.
 */
export const SILENCE_TRIM_FILTER =
  'silenceremove=start_periods=1:start_silence=0.02:start_threshold=-45dB,' +
  'areverse,' +
  'silenceremove=start_periods=1:start_silence=0.04:start_threshold=-45dB,' +
  'areverse';

/** The reference thresholds: -35 dB, 0.10 s (the numbers the delivered film used). */
export const SILENCE_DETECT_FILTER = 'silencedetect=noise=-35dB:d=0.10';

export function probeDurationCommand(path: string): string {
  return `ffprobe -v error -show_entries format=duration -of csv=p=0 ${shellQuote(path)}`;
}

export function trimSilenceCommand(input: string, output: string): string {
  return (
    `ffmpeg -y -v error -i ${shellQuote(input)} -af ${shellQuote(SILENCE_TRIM_FILTER)} ` +
    `-ar 48000 -ac 1 -c:a pcm_s16le ${shellQuote(output)}`
  );
}

/** `ffprobe` duration in seconds. */
async function probeDuration(sandbox: AgentSandbox, path: string): Promise<number> {
  const out = await sandbox.exec(probeDurationCommand(path));
  const value = Number(out.stdout.trim());
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`[video-skill] ffprobe could not read a duration from ${path}`);
  }
  return roundTo(value, 3);
}

/**
 * Trim leading and trailing silence in one pass.
 *
 * The reference pipeline trimmed before timing anything, and so does this: a TTS
 * wav usually opens with 300-800 ms of nothing, which would otherwise become a
 * dead beat at the head of every scene.
 */
async function trimSilence(sandbox: AgentSandbox, input: string, output: string): Promise<void> {
  await sandbox.exec(trimSilenceCommand(input, output));
}

/** The measured silences of one file, at the reference thresholds (-35 dB, 0.10 s). */
export function silenceDetectCommand(path: string): string {
  // silencedetect writes to stderr and exits 0; `-f null -` keeps it from writing a file.
  return `ffmpeg -v info -i ${shellQuote(path)} -af ${shellQuote(SILENCE_DETECT_FILTER)} -f null - 2>&1 || true`;
}

async function detectSilences(sandbox: AgentSandbox, path: string): Promise<SilenceSpan[]> {
  const result = await sandbox.exec(silenceDetectCommand(path));
  return parseSilenceDetect(`${result.stdout}\n${result.stderr}`);
}

// ────────────────────────────────────────────────────────────────────────────
// Step bodies
// ────────────────────────────────────────────────────────────────────────────

interface StepOutput {
  onsets: VoOnset[];
  timing: Timing;
  project: EmittedProject;
}

/**
 * The voiceover step: render each line, trim it, MEASURE it, and write the
 * measurement next to the audio.
 *
 * The measurement is the point. Timing is derived from what the voice did
 * (`silencedetect` + `ffprobe`), never typed.
 */
async function runVoiceStep(
  sandbox: AgentSandbox,
  beats: Beats,
  workDir: string,
  deps: Required<Pick<VideoSkillDeps, 'tts'>>,
  log: (event: string, data?: Record<string, unknown>) => void,
): Promise<StepOutput> {
  const lines = speakableBeats(beats);
  const onsets: VoOnset[] = [];

  for (const beat of lines) {
    const raw = `${workDir}/assets/voice/${beat.id}.raw.wav`;
    const trimmed = `${workDir}/assets/voice/${beat.id}.wav`;

    const rendered = await deps.tts({
      id: beat.id,
      text: beat.vo,
      language: beats.voice.language,
      speaker: beats.voice.speaker,
      scene: beats.voice.scene,
      ...(beats.voice.sampleContext ? { sampleContext: beats.voice.sampleContext } : {}),
      model: VOICE_MODEL,
    });

    if (rendered instanceof Uint8Array) {
      await writeBytes(sandbox, raw, rendered);
    } else {
      // Already on the sandbox filesystem (a resumed run, or a caller that wrote it).
      await sandbox.exec(`mkdir -p ${shellQuote(dirOf(raw))} && cp -f ${shellQuote(rendered.path)} ${shellQuote(raw)}`);
    }

    const total = await probeDuration(sandbox, raw);
    const silences = await detectSilences(sandbox, raw);
    onsets.push(onsetFromMeasurement(beat.id, total, silences));
    await trimSilence(sandbox, raw, trimmed);
    log('video.voice.line', { beat: beat.id, rawSeconds: total, speechSeconds: onsets[onsets.length - 1].dur });
  }

  // Re-verify against the TRIMMED files: that is what the film actually plays.
  for (const onset of onsets) {
    const trimmedSeconds = await probeDuration(sandbox, `${workDir}/assets/voice/${onset.id}.wav`);
    if (trimmedSeconds + 0.02 < onset.dur) {
      // The trim took more than silence; trust the file that exists.
      onset.dur = roundTo(trimmedSeconds, 3);
    }
  }

  const { timing, project } = buildProject(beats, onsets);
  await sandbox.writeFile(
    `${workDir}/voiceover.json`,
    `${JSON.stringify({ onsets, total: timing.total, drift: timing.drift, notes: timing.notes, timing: JSON.parse(timingJsonText(timing)) }, null, 2)}\n`,
  );
  log('video.voice.measured', {
    lines: onsets.length,
    total: timing.total,
    drift: timing.drift,
    s0: timing.sceneList.s0?.dur,
  });
  return { onsets, timing, project };
}

/** Write every emitted file into the sandbox project dir. */
async function writeProject(sandbox: AgentSandbox, workDir: string, project: EmittedProject): Promise<void> {
  for (const file of project.files) {
    await sandbox.writeFile(`${workDir}/${file.path}`, file.content);
  }
  await sandbox.exec(`chmod +x ${shellQuote(`${workDir}/grading.sh`)}`);
}

/**
 * The clips step: every plate in place, graded with ffmpeg, copied where a scene
 * reuses a plate — then the project is emitted around the measured voice.
 *
 * The plates step is also where the emitted project first exists on disk, so its
 * artefact (`project.json`) records exactly what was written.
 */
async function runClipsStep(
  sandbox: AgentSandbox,
  beats: Beats,
  workDir: string,
  deps: VideoSkillDeps,
  onsets: VoOnset[],
  log: (event: string, data?: Record<string, unknown>) => void,
): Promise<StepOutput> {
  for (const plate of beats.plates) {
    if (plate.source === 'asset') {
      const source = plate.key ?? '';
      const bytes = await (deps.loadAsset ?? defaultLoadAsset)(source);
      await writeBytes(sandbox, `${workDir}/assets/src/${plate.id}.mp4`, bytes);
      log('video.plate.asset', { plate: plate.id, bytes: bytes.length });
      continue;
    }

    const seconds = plate.seconds ?? 6;
    const request: ClipRequest = {
      plate: plate.id,
      prompt: plate.prompt ?? '',
      seconds,
      aspect: beats.aspect,
      model: CLIP_MODEL,
    };
    const rendered = await (deps.clip ?? defaultClip)(request);
    if (rendered instanceof Uint8Array) {
      await writeBytes(sandbox, `${workDir}/assets/footage/${plate.id}.raw.mp4`, rendered);
    } else {
      await sandbox.exec(
        `mkdir -p ${shellQuote(`${workDir}/assets/footage`)} && cp -f ${shellQuote(rendered.path)} ${shellQuote(
          `${workDir}/assets/footage/${plate.id}.raw.mp4`,
        )}`,
      );
    }
    log('video.plate.generated', { plate: plate.id, seconds, model: CLIP_MODEL });
  }

  const { timing, project } = buildProject(beats, onsets);
  await writeProject(sandbox, workDir, project);

  // The end card (and the brand bug) reference `endCard.logo` by project-relative
  // path — which is also its R2 key. No file, no <img>: `check` would report
  // missing_local_asset and the renderer would silently drop the mark.
  if (beats.endCard.logo) {
    const bytes = await (deps.loadAsset ?? defaultLoadAsset)(beats.endCard.logo);
    await writeBytes(sandbox, `${workDir}/${beats.endCard.logo}`, bytes);
    log('video.brand.logo', { logo: beats.endCard.logo, bytes: bytes.length });
  }

  // The one warm grade, baked with ffmpeg, plus the per-scene plate copies.
  await sandbox.exec(`cd ${shellQuote(workDir)} && TMPDIR="\${TMPDIR:-/tmp}" sh grading.sh`);

  await sandbox.writeFile(
    `${workDir}/project.json`,
    `${JSON.stringify(
      {
        slug: projectSlug(beats),
        dir: project.dir,
        durationSeconds: project.durationSeconds,
        width: project.width,
        height: project.height,
        fps: project.fps,
        files: project.files.map((file) => file.path),
        plates: project.plates,
        copies: project.copies,
        typeRead: project.typeRead,
        scenes: project.scenes,
        timing: JSON.parse(timingJsonText(timing)),
      },
      null,
      2,
    )}\n`,
  );
  log('video.project.emitted', {
    dir: project.dir,
    files: project.files.length,
    scenes: project.scenes.length,
    durationSeconds: project.durationSeconds,
    copies: project.copies.length,
  });
  return { onsets, timing, project };
}

/**
 * Parse a `hyperframes check` report: a render only starts on zero errors.
 *
 * Two shapes exist and both are real:
 *  - the JSON the CLI prints (a summary object), and
 *  - the report file it saves under `.hyperframes/artifacts/checks/<id>.json`,
 *    which is sectioned: `{ lint: { errorCount, warningCount }, runtime: {…}, … }`.
 *
 * Read defensively in the one direction that matters: a missing count is NEVER
 * read as "zero errors". An unknown report is a failed check, not a clean bill.
 */
export function parseCheckJson(text: string): { errors: number; warnings: number; raw: unknown } {
  const source = String(text);
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error(`[video-skill] check --json produced no JSON: ${source.slice(0, 400)}`);
  }
  const parsed = JSON.parse(source.slice(start, end + 1)) as Record<string, unknown>;

  const numeric = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

  // 1. the sectioned report file
  let errors = 0;
  let warnings = 0;
  let sawSection = false;
  for (const value of Object.values(parsed)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const section = value as Record<string, unknown>;
    const sectionErrors = numeric(section.errorCount);
    if (sectionErrors === null) continue;
    sawSection = true;
    errors += sectionErrors;
    warnings += numeric(section.warningCount) ?? 0;
  }
  if (sawSection) return { errors, warnings, raw: parsed };

  // 2. a flat summary: { errors, warnings } or { summary: { … } }
  const summary = (parsed.summary ?? parsed.totals ?? parsed) as Record<string, unknown>;
  const flatErrors =
    numeric(summary.errors) ?? numeric(summary.errorCount) ?? numeric(summary.error) ?? null;
  const flatWarnings =
    numeric(summary.warnings) ?? numeric(summary.warningCount) ?? numeric(summary.warning) ?? 0;
  if (flatErrors !== null) return { errors: flatErrors, warnings: flatWarnings, raw: parsed };

  throw new Error(
    '[video-skill] check reported no machine-readable error count; refusing to treat that as ' +
      `"clean". Run the project through \`npx hyperframes@${PROJECT_CLI_VERSION} check\` and read it.`,
  );
}

/**
 * Where the CLI puts the machine-readable report, newest first.
 *
 * `check --json` writes its report to a file as well as printing it, and on a slow
 * machine the printed JSON can be interleaved with progress lines — so the render
 * step falls back to the file rather than guessing at stdout.
 */
export function checkReportCommand(): string {
  return 'ls -t .hyperframes/artifacts/checks/*.json 2>/dev/null | head -1 | xargs -r cat';
}

/**
 * Warning codes that are ERRORS for this skill, because each one describes an
 * element whose real position or size is unknown to the audit.
 *
 * `nested_structure_needs_subcomposition` was the exact finding on `#brand-bug`
 * while it was a root-level `<div class="clip">` with an `<img>` inside: the report
 * said `bbox {x:0,y:0,width:0,height:0}` and `ok: true` while the render painted an
 * opaque cream bar over the left fifth of every frame. A zero-size box that is
 * nonetheless drawing is the "hidden overlay" case — it must stop a render, not
 * appear in a warning list nobody reads.
 */
export const FATAL_WARNING_CODES: readonly string[] = ['nested_structure_needs_subcomposition'];

export interface CheckFinding {
  code: string;
  severity: string;
  message: string;
  selector: string;
}

/** Every finding in a report, whichever shape it arrived in. */
export function checkFindings(raw: unknown): CheckFinding[] {
  const out: CheckFinding[] = [];
  const collect = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue;
      const finding = entry as Record<string, unknown>;
      if (typeof finding.code !== 'string') continue;
      out.push({
        code: finding.code,
        severity: String(finding.severity ?? ''),
        message: String(finding.message ?? ''),
        selector: String(finding.selector ?? ''),
      });
    }
  };
  const root = (raw ?? {}) as Record<string, unknown>;
  collect(root.findings);
  for (const value of Object.values(root)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      collect((value as Record<string, unknown>).findings);
    }
  }
  return out;
}

/**
 * Findings that must stop a render even though the audit called them warnings.
 *
 * Trap 8 restated as code: `check` reporting `ok: true` is not proof that what was
 * drawn is what was authored. Anything describing a box it could not measure, or a
 * root element that is really a scene, is treated as fatal here.
 */
export function fatalCheckFindings(raw: unknown): string[] {
  return checkFindings(raw)
    .filter(
      (finding) =>
        FATAL_WARNING_CODES.includes(finding.code) ||
        /bbox[^;]*\b(0|0px)\b/i.test(finding.message) ||
        /width["']?:\s*0/.test(finding.message),
    )
    .map((finding) => `${finding.code} [${finding.selector || 'no selector'}]: ${finding.message.slice(0, 240)}`);
}

/**
 * The render step: check, render, publish to R2, record the key on the run.
 *
 * `check --json` must report 0 errors BEFORE a frame is rendered — that is the
 * cheapest possible failure, and the reference found three real bugs through it.
 */
async function runRenderStep(
  sandbox: AgentSandbox,
  beats: Beats,
  workDir: string,
  runId: string,
  deps: VideoSkillDeps,
  log: (event: string, data?: Record<string, unknown>) => void,
): Promise<{ url: string; key: string; bytes: number; check: { errors: number; warnings: number } }> {
  const cli = `npx --yes hyperframes@${PROJECT_CLI_VERSION}`;

  const check = await sandbox.exec(
    `cd ${shellQuote(workDir)} && ${cli} check --json 2>&1`,
    { allowNonZero: true, timeoutMs: 20 * 60_000 },
  );

  // Two places the report can be: the JSON the CLI printed, and the file it saves.
  // Try the stream, then the file, and only then give up — a report we cannot read
  // is a failed check, never a clean one.
  let parsed: { errors: number; warnings: number; raw: unknown };
  try {
    parsed = parseCheckJson(`${check.stdout}\n${check.stderr}`);
  } catch (streamError) {
    const report = await sandbox.exec(`cd ${shellQuote(workDir)} && ${checkReportCommand()}`, {
      allowNonZero: true,
    });
    try {
      parsed = parseCheckJson(report.stdout);
    } catch {
      throw new Error(
        `[video-skill] could not read the check report (${detailOf(streamError)}). ` +
          `The report file is under ${workDir}/.hyperframes/artifacts/checks/ — read it before rendering.`,
      );
    }
  }
  if (parsed.errors > 0) {
    throw new Error(
      `[video-skill] hyperframes check reports ${parsed.errors} error(s) in ${projectSlug(beats)}; ` +
        'refusing to render. Fix the composition first — a render that starts dirty wastes the ' +
        'whole step and the sandbox time it burns.',
    );
  }

  // `ok: true` is not the same as "what was drawn is what was authored" (trap 8). A
  // finding describing an element whose box the audit could not measure — the exact
  // shape of the brand-bug bar that shipped past a clean check — stops the render.
  const fatal = fatalCheckFindings(parsed.raw);
  if (fatal.length) {
    throw new Error(
      `[video-skill] hyperframes check reported no errors but flagged ${fatal.length} ` +
        `structurally-invisible element(s) in ${projectSlug(beats)}; refusing to render. A box the ` +
        `audit cannot measure is a box that can paint over the film:\n  - ${fatal.join('\n  - ')}`,
    );
  }

  // One value, read once, carried through the whole step. A check that did not run
  // is not a check that passed: everything below is only reachable when a real
  // report said 0 errors, and that report is what the run row records.
  const checkSummary = { errors: parsed.errors, warnings: parsed.warnings };
  log('video.check.clean', { errors: checkSummary.errors, warnings: checkSummary.warnings });

  const render = await sandbox.exec(
    `cd ${shellQuote(workDir)} && TMPDIR="\${TMPDIR:-/tmp}" ${cli} render . -o out.mp4 --quality looks --fps ${beats.fps} 2>&1 | tail -40`,
    { timeoutMs: 40 * 60_000 },
  );
  const probe = await sandbox.exec(`test -s ${shellQuote(`${workDir}/out.mp4`)}`, { allowNonZero: true });
  if (probe.exitCode !== 0) {
    throw new Error(
      `[video-skill] the render produced no out.mp4 in ${workDir}. Last output: ` +
        `${String(render.stdout).split(/\r?\n/).filter(Boolean).slice(-6).join(' | ')}`,
    );
  }

  const seconds = await probeDuration(sandbox, `${workDir}/out.mp4`);
  const sizeOut = await sandbox.exec(`wc -c < ${shellQuote(`${workDir}/out.mp4`)}`);
  const bytes = Number(sizeOut.stdout.trim()) || 0;

  const key = artefactKeyFor(beats);
  const published = await (deps.publish ?? defaultPublish)({
    sandbox,
    sandboxPath: `${workDir}/out.mp4`,
    key,
    contentType: 'video/mp4',
  });

  const artefact: RunArtefact = {
    key,
    url: published.url,
    seconds,
    bytes: bytes || published.bytes,
    fps: beats.fps,
    aspect: beats.aspect,
    slug: projectSlug(beats),
    jobId: beats.jobId,
    check: checkSummary,
  };

  const recorded = await (deps.record ?? defaultRecord)(runId, artefact);
  log(recorded.recorded ? 'video.artefact.recorded' : 'video.artefact.record_failed', {
    runId,
    key,
    url: published.url,
    seconds,
    reason: recorded.reason,
  });

  return { url: published.url, key, bytes: artefact.bytes, check: checkSummary };
}

// ────────────────────────────────────────────────────────────────────────────
// Default vendor implementations (lazy: nothing is imported until used)
// ────────────────────────────────────────────────────────────────────────────

const TTS_POLL_MS = 2_500;
const TTS_POLL_TRIES = 20; // ~50 s, comfortably inside the 45 s model timeout plus retry
const CLIP_POLL_MS = 10_000;
const CLIP_POLL_TRIES = 60; // ~10 min, the video route's registered timeout

async function pollForUrl(
  taskId: string,
  tries: number,
  waitMs: number,
): Promise<{ url: string | null; reason: string | null }> {
  const api = await import('@/utils/external-apis');
  let last: string | null = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    const result = await api.queryKieTask(taskId);
    if (result.state === 'success' && result.resultUrl) return { url: result.resultUrl, reason: null };
    if (result.state === 'fail') return { url: null, reason: result.error ?? 'task failed' };
    last = result.state;
  }
  return { url: null, reason: `still ${last ?? 'pending'} after ${tries} polls` };
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`[video-skill] download failed: HTTP ${response.status} for ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Default voice line: the registry's voice model, through the registry route.
 *
 * The two traps are in `createGeminiTTS` and must stay there: `input.speakers[]`
 * is required (a flat text payload is rejected with `500 "speakers is a required
 * parameter"`), and a NON-EMPTY per-speaker `style` is rejected with HTTP 422 — so
 * delivery direction goes in `scene`, never in `style`.
 */
async function defaultTts(request: VoiceRequest): Promise<Uint8Array> {
  const api = await import('@/utils/external-apis');
  const routed = await withMediaFallback('voice', async (model: string) =>
    api.createGeminiTTS({
      dialogueText: request.text,
      speakerName: request.speaker,
      style: '',
      scene: request.scene,
      ...(request.sampleContext ? { sampleContext: request.sampleContext } : {}),
      model,
    }),
  );
  if (!routed.ok || !routed.value?.taskId) {
    throw new Error(`[video-skill] voice line ${request.id} failed: ${routed.reason ?? 'no taskId'}`);
  }
  const polled = await pollForUrl(routed.value.taskId, TTS_POLL_TRIES, TTS_POLL_MS);
  if (!polled.url) {
    throw new Error(`[video-skill] voice line ${request.id} produced no audio: ${polled.reason}`);
  }
  return download(polled.url);
}

/** Default motion plate: the registry's video model (MEDIA_MODELS.video.id), one slow move. */
async function defaultClip(request: ClipRequest): Promise<Uint8Array> {
  const api = await import('@/utils/external-apis');
  const routed = await withMediaFallback('video', async (model: string) =>
    api.createGrokVideoTask({
      prompt: request.prompt,
      aspectRatio: request.aspect,
      resolution: '1080p',
      duration: Math.min(6, Math.max(1, Math.round(request.seconds))),
      model,
    }),
  );
  if (!routed.ok || !routed.value?.taskId) {
    throw new Error(`[video-skill] plate ${request.plate} failed: ${routed.reason ?? 'no taskId'}`);
  }
  const polled = await pollForUrl(routed.value.taskId, CLIP_POLL_TRIES, CLIP_POLL_MS);
  if (!polled.url) throw new Error(`[video-skill] plate ${request.plate} produced no clip: ${polled.reason}`);
  return download(polled.url);
}

/** Default supplied plate: an https URL, or an R2 key in the app bucket. */
async function defaultLoadAsset(key: string): Promise<Uint8Array> {
  if (/^https?:\/\//i.test(key)) return download(key);
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const { r2, R2_BUCKET } = await import('@/utils/r2');
  const response = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key.replace(/^\/+/, '') }));
  const body = response.Body as unknown as { transformToByteArray(): Promise<Uint8Array> } | undefined;
  if (!body || typeof body.transformToByteArray !== 'function') {
    throw new Error(`[video-skill] R2 returned no body for ${key}`);
  }
  return body.transformToByteArray();
}

/** Default publish: a presigned PUT, so a 120 MB render never travels through stdout. */
async function defaultPublish(args: {
  sandbox: AgentSandbox;
  sandboxPath: string;
  key: string;
  contentType: string;
}): Promise<UploadResult> {
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  const { r2, R2_BUCKET, R2_PUBLIC_URL } = await import('@/utils/r2');

  const url = await getSignedUrl(
    r2 as never,
    new PutObjectCommand({ Bucket: R2_BUCKET, Key: args.key, ContentType: args.contentType }) as never,
    { expiresIn: 3600 },
  );

  await args.sandbox.exec(
    `curl -fsS -X PUT -T ${shellQuote(args.sandboxPath)} -H ${shellQuote(
      `Content-Type: ${args.contentType}`,
    )} ${shellQuote(url)} > /dev/null`,
  );

  const size = await args.sandbox.exec(`wc -c < ${shellQuote(args.sandboxPath)}`);
  const publicUrl = `${R2_PUBLIC_URL.replace(/\/+$/, '')}/${args.key}`;
  return { url: publicUrl, bytes: Number(size.stdout.trim()) || 0 };
}

/**
 * Default record: the artefact key on the run row.
 *
 * Two columns, both additive (`supabase/migrations/20261216000000_agent_run_artefact.sql`).
 * A database that has not had the migration applied must not break a finished
 * render, so a missing-column error is reported, not thrown: the caller gets
 * `recorded: false` and a reason, and the log says the same thing.
 */
async function defaultRecord(runId: string, artefact: RunArtefact): Promise<RecordResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { recorded: false, reason: 'no Supabase service-role credentials in this process' };
  }
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  return recordRunArtefact(supabase, runId, artefact);
}

/**
 * The one place the R2 key is written onto `agent_runs`. Never throws: a run that
 * rendered and published is finished, and losing the bookkeeping write must not
 * turn it into a failure the runner would retry (and re-charge for).
 */
export async function recordRunArtefact(
  supabase: unknown,
  runId: string,
  artefact: RunArtefact,
): Promise<RecordResult> {
  const db = supabase as { from?: (table: string) => unknown } | null;
  if (!db || typeof db.from !== 'function') {
    return { recorded: false, reason: 'no Supabase client' };
  }

  const table = db.from('agent_runs') as {
    update: (values: Record<string, unknown>) => { eq: (column: string, value: string) => PromiseLike<{ error: { message?: string; code?: string } | null }> };
  };

  try {
    const { error } = await table
      .update({
        artefact_key: artefact.key,
        artefact_url: artefact.url,
        artefact_meta: {
          seconds: artefact.seconds,
          bytes: artefact.bytes,
          fps: artefact.fps,
          aspect: artefact.aspect,
          slug: artefact.slug,
          job_id: artefact.jobId,
          check: artefact.check,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('run_id', runId);

    if (!error) return { recorded: true, reason: null };

    const text = `${error.code ?? ''} ${error.message ?? ''}`;
    if (/PGRST204|42703|does not exist|schema cache/i.test(text)) {
      return {
        recorded: false,
        reason:
          `agent_runs has no artefact_key column yet (${text.trim()}). Apply ` +
          'supabase/migrations/20261216000000_agent_run_artefact.sql; the film is published and ' +
          `its key is ${artefact.key}.`,
      };
    }
    return { recorded: false, reason: text.trim() || 'unknown Supabase error' };
  } catch (error) {
    return { recorded: false, reason: detailOf(error) };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// The skill entry point
// ────────────────────────────────────────────────────────────────────────────

export interface VideoSkillRunOptions {
  /** Keys the checkpoint, the credit hold and the R2 artefacts. Stable across retries. */
  runId: string;
  /** Who pays. */
  userId: string;
  input: VideoSkillInput;
  deps?: VideoSkillDeps;
  log?: AgentLogger;
  /** Runner tuning, passed straight through. */
  idlePauseMs?: number;
  softCapMs?: number;
  maxAttemptsPerStep?: number;
  /** Injection seams for the durable runner (tests). */
  supabase?: unknown;
  sandboxes?: unknown;
  store?: unknown;
  credits?: unknown;
  artefactExists?: unknown;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface VideoSkillResult {
  plan: VideoSkillPlan;
  runId: string;
  /** The published film. */
  artefact: { key: string; url: string; bytes: number; check: { errors: number; warnings: number } | null } | null;
  recorded: RecordResult;
  completed: string[];
  skipped: string[];
  charged: number;
  pauses: number;
  sandboxId: string;
  durationSeconds: number;
}

/**
 * Render one film: plan -> durable three-step run -> R2 -> the key on the run row.
 *
 * Throws whatever stopped it. A throw means "retry with the SAME runId": the
 * runner has already paused the sandbox, refunded the unspent reserve and
 * recorded the failure on the row, and every completed step is checkpointed.
 */
export async function runVideoSkill(options: VideoSkillRunOptions): Promise<VideoSkillResult> {
  if (!options?.runId) throw new Error('[video-skill] runVideoSkill needs a runId');
  if (!options?.userId) throw new Error('[video-skill] runVideoSkill needs a userId — the run is billed to it');

  const log = options.log ?? consoleLogger;
  const plan = planVideoSkill(options.input);
  const beats = plan.beats;

  // The reservation is quoted from the registry BEFORE the first vendor call.
  log('video.plan', {
    briefing: plan.briefing,
    slug: plan.slug,
    artefact: plan.artefactKey,
    credits: plan.credits,
    steps: plan.steps,
    notes: plan.notes,
  });

  const { runVideoPipeline } = await import('../../../sandbox/pipeline');

  const workDir = `/home/user/work/${plan.slug}`;
  const deps: VideoSkillDeps = options.deps ?? {};
  let published: { url: string; key: string; bytes: number; check: { errors: number; warnings: number } } | null = null;
  let recordResult: RecordResult = { recorded: false, reason: 'the render step did not run' };
  let measured: Timing | null = null;

  /** Voice onsets, from the sandbox or (on a fresh workspace) from R2. */
  const onsetsFor = async (sandbox: AgentSandbox, ctx: StepContext): Promise<VoOnset[]> => {
    const local = `${workDir}/voiceover.json`;
    const exists = await sandbox.exec(`test -s ${shellQuote(local)}`, { allowNonZero: true });
    if (exists.exitCode === 0) {
      const text = await sandbox.exec(`cat ${shellQuote(local)}`);
      return (JSON.parse(text.stdout) as { onsets: VoOnset[] }).onsets;
    }

    const key = voiceArtefactKeyFor(beats);
    const stored = await (deps.readArtefact ?? defaultReadArtefact)(key);
    if (stored) {
      const parsed = JSON.parse(stored) as { onsets: VoOnset[] };
      await sandbox.writeFile(local, stored);
      ctx.log('video.voice.restored', { key, lines: parsed.onsets.length, note: 'fresh workspace' });
      return parsed.onsets;
    }

    throw new Error(
      `[video-skill] step ${ctx.runId}: the measured voice is neither in the workspace nor at ${key}. ` +
        'The voice step has to run (and be charged) before the plates can be cut around it.',
    );
  };

  const job = {
    jobId: plan.slug,
    script: speakableBeats(beats).map((b) => b.vo).join(' '),
    clipPrompt: beats.plates.find((p) => p.source === 'generate')?.prompt ?? '',
    clipSeconds: plan.clipSeconds,
    workDir: `work/${plan.slug}`,
    artefacts: {
      voiceover: voiceArtefactKeyFor(beats),
      clips: projectArtefactKeyFor(beats),
      render: artefactKeyFor(beats),
    },
    sandboxPaths: {
      voiceover: `${workDir}/voiceover.json`,
      clips: `${workDir}/project.json`,
      render: `${workDir}/out.mp4`,
    },
    run: {
      async voiceover(sandbox: SandboxLike, ctx: StepContext) {
        const exec = sandboxOf(sandbox, 'voiceover');
        await exec.exec(`mkdir -p ${shellQuote(workDir)}/assets/voice`);
        const output = await runVoiceStep(
          exec,
          beats,
          workDir,
          { tts: deps.tts ?? defaultTts },
          ctx.log,
        );
        measured = output.timing;
        // The measurement is the step's artefact: a resumed run can rebuild the
        // clock from it without paying for the voice again.
        await (deps.publish ?? defaultPublish)({
          sandbox: exec,
          sandboxPath: `${workDir}/voiceover.json`,
          key: voiceArtefactKeyFor(beats),
          contentType: 'application/json',
        });
      },

      async clips(sandbox: SandboxLike, ctx: StepContext) {
        const exec = sandboxOf(sandbox, 'clips');
        const onsets = await onsetsFor(exec, ctx);
        const output = await runClipsStep(exec, beats, workDir, deps, onsets, ctx.log);
        measured = output.timing;
        await (deps.publish ?? defaultPublish)({
          sandbox: exec,
          sandboxPath: `${workDir}/project.json`,
          key: projectArtefactKeyFor(beats),
          contentType: 'application/json',
        });
      },

      async render(sandbox: SandboxLike, ctx: StepContext) {
        const exec = sandboxOf(sandbox, 'render');
        const result = await runRenderStep(exec, beats, workDir, ctx.runId, deps, ctx.log);
        published = { url: result.url, key: result.key, bytes: result.bytes, check: result.check };
        recordResult = await (deps.record ?? defaultRecord)(ctx.runId, {
          key: result.key,
          url: result.url,
          seconds: measured?.total ?? 0,
          bytes: result.bytes,
          fps: beats.fps,
          aspect: beats.aspect,
          slug: plan.slug,
          jobId: beats.jobId,
          check: result.check,
        });
      },
    },
  };

  const result = await runVideoPipeline({
    runId: options.runId,
    userId: options.userId,
    job,
    ...(options.supabase !== undefined ? { supabase: options.supabase } : {}),
    ...(options.sandboxes !== undefined ? { sandboxes: options.sandboxes as never } : {}),
    ...(options.store !== undefined ? { store: options.store as never } : {}),
    ...(options.credits !== undefined ? { credits: options.credits as never } : {}),
    ...(options.artefactExists !== undefined ? { artefactExists: options.artefactExists as never } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.sleep ? { sleep: options.sleep } : {}),
    ...(options.idlePauseMs !== undefined ? { idlePauseMs: options.idlePauseMs } : {}),
    ...(options.softCapMs !== undefined ? { softCapMs: options.softCapMs } : {}),
    ...(options.maxAttemptsPerStep !== undefined ? { maxAttemptsPerStep: options.maxAttemptsPerStep } : {}),
    log,
  });

  const artefact = published as VideoSkillResult['artefact'];
  if (!artefact) {
    throw new Error(
      `[video-skill] run ${options.runId} completed its steps but published nothing. ` +
        'The render step must produce final.mp4 — check the step log before trusting this run.',
    );
  }

  // Read through a widened type: `measured` is only ever assigned inside the step
  // closures, which the compiler cannot see into.
  const measuredTotal = (measured as Timing | null)?.total ?? 0;

  log('video.published', {
    runId: options.runId,
    key: artefact.key,
    url: artefact.url,
    recorded: recordResult.recorded,
    reason: recordResult.reason,
    durationSeconds: measuredTotal || null,
  });

  return {
    plan,
    runId: options.runId,
    artefact,
    recorded: recordResult,
    completed: result.completed,
    skipped: result.skipped,
    charged: result.charged,
    pauses: result.pauses,
    sandboxId: result.sandboxId,
    durationSeconds: measuredTotal,
  };
}

/** Read an artefact's text back out of R2 (resume path). */
async function defaultReadArtefact(key: string): Promise<string | null> {
  try {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { r2, R2_BUCKET } = await import('@/utils/r2');
    const response = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    const body = response.Body as unknown as { transformToString(): Promise<string> } | undefined;
    return body && typeof body.transformToString === 'function' ? body.transformToString() : null;
  } catch {
    return null;
  }
}
