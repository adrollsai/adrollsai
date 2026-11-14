/**
 * ACCEPTANCE HARNESS — proves the video skill's toolchain on a real render.
 *
 *   npm run proof:video-skill
 *
 * It runs the SAME pipeline the skill runs, minus the sandbox and minus the
 * vendors:
 *
 *   1. synthesise one voice file per beat (ffmpeg tones, NOT real TTS — no vendor
 *      is called and no money is spent);
 *   2. MEASURE them with the exact commands `index.ts` issues
 *      (`probeDurationCommand`, `SILENCE_DETECT_FILTER`, `trimSilenceCommand`),
 *      parsed by the exact pure helpers (`parseSilenceDetect`,
 *      `onsetFromMeasurement`), so the clock in the film is a measured clock;
 *   3. emit the HyperFrames project with `buildProject` and write it to disk;
 *   4. synthesise the plates and run the emitted `grading.sh` for real (Git Bash +
 *      ffmpeg), including the per-scene plate copies;
 *   5. `hyperframes check --json` (must be 0 errors), then `render` a ≤8 s span at
 *      9:16, then pull frames out of the delivered MP4 to look at.
 *
 * Everything is written under D:\nobo-renders (this machine has ~2.4 GB free on C:
 * and ~145 GB on D:), and TMPDIR points at D:\nobo-tmp.
 *
 *   node scripts/video-skill-render-proof.ts --start 0 --end 7
 */
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildProject,
  onsetFromMeasurement,
  parseCheckJson,
  parseSilenceDetect,
  planVideoSkill,
  probeDurationCommand,
  silenceDetectCommand,
  trimSilenceCommand,
  projectArtefactKeyFor,
  artefactKeyFor,
} from '../lib/agent/tools/skills/video/index';
import { PROJECT_CLI_VERSION } from '../lib/agent/tools/skills/video/emit';
import type { VoOnset } from '../lib/agent/tools/skills/video/timing';

const ROOT = process.env.NOBO_RENDER_ROOT || 'D:\\nobo-renders';
const TMP = process.env.NOBO_TMP_ROOT || 'D:\\nobo-tmp';
const BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';

/** POSIX form of a Windows path, for the Git Bash invocations. */
const posix = (p: string) => p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);

/**
 * Run a command string through the platform shell.
 *
 * `execSync` (not execFileSync) on purpose: it hands the string to cmd.exe
 * verbatim, so the quoting inside the pipeline's own shell commands is what ffmpeg
 * actually receives — the same thing that happens in the E2B sandbox.
 */
function run(command: string, cwd?: string): string {
  return String(
    execSync(command, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, TEMP: TMP, TMP, TMPDIR: TMP },
    }),
  );
}

let scriptSeq = 0;
/** Run a POSIX shell script under Git Bash. Written with LF endings, always. */
function bashScript(script: string, cwd?: string): string {
  const file = path.join(TMP, `proof-${process.pid}-${scriptSeq++}.sh`);
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(file, script.replace(/\r\n/g, '\n'), 'utf8');
  const out = execFileSync(BASH, [file], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, TEMP: TMP, TMP, TMPDIR: posix(TMP) },
  });
  return String(out);
}

/** Same as `run`, but a non-zero exit is a RESULT (a check can legitimately fail). */
function runSafe(command: string, cwd?: string): { code: number; out: string } {
  try {
    return { code: 0, out: run(command, cwd) };
  } catch (error: any) {
    return {
      code: typeof error?.status === 'number' ? error.status : 1,
      out: `${error?.stdout ?? ''}${error?.stderr ?? ''}`,
    };
  }
}

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : String(process.argv[index + 1] ?? fallback);
}

/** Newest `check` report the CLI wrote into a project. */
function newestCheckReport(dir: string): string | null {
  const checks = path.join(dir, '.hyperframes', 'artifacts', 'checks');
  if (!fs.existsSync(checks)) return null;
  const files = fs
    .readdirSync(checks)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(checks, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] ?? null;
}

// ── the plan: a real beats file, at the real floor (never under 30 s) ─────────
const BEATS = {
  version: 1 as const,
  jobId: 'proof-toolchain',
  aspect: '9:16' as const,
  fps: 30,
  targetSeconds: 30,
  onScreenLanguage: 'en',
  logoOnScreen: true,
  voice: {
    language: 'hinglish',
    speaker: 'Charon',
    scene: 'Confident Indian narrator, warm authority, no shouting.',
  },
  endCard: {
    name: 'Meridian Group',
    tagline: 'Spaces That Keep Their Promise',
    numbers: ['9876500123', '9876500456'],
    address: ['4th Floor, Sector 34', 'Chandigarh'],
    pledge: 'YOUR NEED, OUR PRIORITY',
    // A project-relative path AND the R2 key of the supplied logo.
    logo: 'assets/brand/logo.png',
  },
  plates: [
    { id: 'hook-a', source: 'asset' as const, key: 'assets/src/hook-a.mp4' },
    { id: 'types-a', source: 'generate' as const, prompt: 'slow push in on towers', seconds: 5 },
    { id: 'card-a', source: 'asset' as const, key: 'assets/src/card-a.mp4' },
    { id: 'cta-a', source: 'generate' as const, prompt: 'slow pan over a dusk skyline', seconds: 4 },
    { id: 'numbers-a', source: 'asset' as const, key: 'assets/src/numbers-a.mp4' },
    { id: 'end-a', source: 'asset' as const, key: 'assets/src/end-a.mp4' },
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
    { id: 's1', kind: 'hook' as const, beats: ['p01'], plate: 'hook-a' },
    { id: 's2', kind: 'beat' as const, beats: ['p02', 'p03'], plate: 'types-a' },
    { id: 's3', kind: 'list' as const, beats: ['p04', 'p05', 'p06'], plate: 'hook-a' },
    { id: 's4', kind: 'info' as const, beats: ['p07', 'p08'], plate: 'card-a' },
    { id: 's5', kind: 'cta' as const, beats: ['p09'], plate: 'cta-a' },
    { id: 's6', kind: 'numbers' as const, beats: [], dur: 2.4, plate: 'numbers-a' },
    { id: 's7', kind: 'endcard' as const, beats: ['p10'], plate: 'end-a' },
  ],
};

/** How long each synthetic "voice line" speaks, so the clock has real material. */
const SPEECH_SECONDS: Record<string, number> = {
  p01: 3.0, p02: 2.6, p03: 2.4, p04: 3.2, p05: 2.2, p06: 2.6, p07: 2.0, p08: 2.2, p09: 2.2, p10: 3.2,
};

function main(): void {
  fs.mkdirSync(TMP, { recursive: true });
  const plan = planVideoSkill({ beats: BEATS });
  const beats = plan.beats;
  const base = path.join(ROOT, 'proof', plan.slug);
  // A previous run's Chrome may still hold a handle in the tree on Windows, so a
  // failed clean is not fatal: use the next free directory name.
  let dir = base;
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-r${attempt}`;
    try {
      fs.rmSync(candidate, { recursive: true, force: true });
      dir = candidate;
      break;
    } catch {
      dir = candidate;
    }
  }
  fs.mkdirSync(path.join(dir, 'assets', 'voice'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets', 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets', 'footage'), { recursive: true });

  console.log(`project: ${dir}`);
  console.log(`plan:    ${plan.briefing}`);
  console.log(`credits: ${plan.credits.total} (${plan.credits.lines.map((l) => `${l.media}=${l.credits}`).join(', ')})`);
  console.log(`key:     ${artefactKeyFor(beats)} / ${projectArtefactKeyFor(beats)}\n`);

  // ── 1 + 2: synthesise the voice, then MEASURE it with the pipeline's commands ─
  const onsets: VoOnset[] = [];
  for (const beat of beats.beats) {
    if (!beat.vo) continue;
    const raw = path.join(dir, 'assets', 'voice', `${beat.id}.raw.wav`);
    const trimmed = path.join(dir, 'assets', 'voice', `${beat.id}.wav`);
    const speech = SPEECH_SECONDS[beat.id] ?? 2.4;

    // 0.4 s of leading silence (adelay) + a modulated tone + 0.3 s of tail (apad),
    // so BOTH the trim and silencedetect have something real to find. NOT real TTS:
    // no vendor is called and nothing is spent.
    bashScript(
      [
        'ffmpeg -y -v error -f lavfi -i',
        `"sine=frequency=${180 + onsets.length * 20}:duration=${speech}:sample_rate=48000"`,
        '-af "tremolo=f=3.2:d=0.7,volume=0.35,adelay=400,apad=pad_dur=0.30"',
        '-c:a pcm_s16le',
        `"${raw}"`,
      ].join(' '),
    );

    // The exact commands index.ts issues, through the same shell the sandbox uses.
    const total = Number(bashScript(probeDurationCommand(raw)).trim());
    const detected = bashScript(silenceDetectCommand(raw));
    const silences = parseSilenceDetect(detected);
    const onset = onsetFromMeasurement(beat.id, total, silences);
    onsets.push(onset);

    bashScript(trimSilenceCommand(raw, trimmed));
    const trimmedSeconds = Number(bashScript(probeDurationCommand(trimmed)).trim());
    if (trimmedSeconds + 0.02 < onset.dur) onset.dur = Math.round(trimmedSeconds * 1000) / 1000;

    console.log(
      `voice ${beat.id}: raw ${total.toFixed(3)}s, lead ${(onset.lead ?? 0).toFixed(3)}s, ` +
        `speech ${onset.dur.toFixed(3)}s, trimmed ${trimmedSeconds.toFixed(3)}s`,
    );
  }

  // ── 3: the clock and the project, from the measurement ──────────────────────
  const { timing, project } = buildProject(beats, onsets);
  console.log(
    `\ntiming: total ${timing.total}s, s0 ${timing.sceneList.s0.dur}s, scenes ${Object.keys(timing.sceneList).length}, drift ${timing.drift}s`,
  );
  for (const [id, scene] of Object.entries(timing.sceneList)) {
    console.log(`  ${id.padEnd(3)} ${String(scene.start).padStart(7)}s + ${String(scene.dur).padStart(6)}s`);
  }

  for (const file of project.files) {
    const target = path.join(dir, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content);
  }
  console.log(`\nemitted ${project.files.length} files (${project.copies.length} plate copies)`);

  // ── 4: plates + the emitted grading.sh, run for real ────────────────────────
  const SOURCES: [string, string, string][] = [
    // id, lavfi source, extra
    ['hook-a', 'gradients=s=1080x1920:c0=0x8a5a20:c1=0x1a1208:x0=0:y0=0:x1=1080:y1=1920:d=8', '0.4'],
    ['card-a', 'gradients=s=1080x1920:c0=0x16301f:c1=0x0b1710:x0=0:y0=0:x1=1080:y1=1920:d=6', '0.2'],
    ['numbers-a', 'gradients=s=1080x1920:c0=0x2a1a3a:c1=0x0b0a08:x0=0:y0=0:x1=1080:y1=1920:d=5', '0.6'],
    ['end-a', 'gradients=s=1080x1920:c0=0x3a2a12:c1=0x0b0a08:x0=0:y0=0:x1=1080:y1=1920:d=8', '1.0'],
  ];
  for (const [id, source] of SOURCES) {
    bashScript(
      `ffmpeg -y -v error -f lavfi -i "${source}" -t 8 -r 30 -pix_fmt yuv420p -c:v libx264 -preset veryfast -crf 20 "${path.join(dir, 'assets', 'src', `${id}.mp4`)}"`,
    );
  }
  for (const plate of beats.plates.filter((p) => p.source === 'generate')) {
    const seconds = plate.seconds ?? 6;
    bashScript(
      `ffmpeg -y -v error -f lavfi -i "testsrc2=s=1080x1920:r=30:d=${seconds}" -t ${seconds} -pix_fmt yuv420p -c:v libx264 -preset veryfast -crf 22 "${path.join(dir, 'assets', 'footage', `${plate.id}.raw.mp4`)}"`,
    );
  }
  console.log('plates synthesised');

  // The supplied logo: a flat brand plate, so the end card's <img> and the brand
  // bug have a real file to reference (a missing one is a 404 at render time).
  if (beats.endCard.logo) {
    const logo = path.join(dir, beats.endCard.logo);
    fs.mkdirSync(path.dirname(logo), { recursive: true });
    bashScript(`ffmpeg -y -v error -f lavfi -i "color=c=0xf5f0e6:s=616x336" -frames:v 1 "${logo}"`);
  }

  // The emitted grading script, run for real: the ffmpeg grade plus the copies.
  const gradeOut = bashScript(`cd '${posix(dir)}' && FFMPEG=ffmpeg sh grading.sh 2>&1`, dir);
  console.log(`grading.sh: ${gradeOut.trim().split(/\r?\n/).slice(-1)[0]}`);

  // ── 5: check, render a ≤8 s span, then look at real frames ──────────────────
  inspect(dir, beats.fps);
}

/**
 * Step 5 on its own: verify the check report, render a ≤8 s span of the film, and
 * pull frames out of the delivered MP4.
 *
 * `--reuse <dir>` runs just this, so a project that is already graded and checked
 * can be re-rendered without repeating two minutes of ffmpeg and five of audits.
 */
function inspect(dir: string, fps: number): void {
  const cli = `npx --yes hyperframes@${PROJECT_CLI_VERSION}`;

  const checkRun = runSafe(`${cli} check --json 2>&1`, dir);
  let parsed: { errors: number; warnings: number };
  let source = 'stdout';
  try {
    parsed = parseCheckJson(checkRun.out);
  } catch {
    // `check --json` prints progress AND saves the report; when stdout carries no
    // parseable summary, the saved report is the authority — never "assume clean".
    const report = newestCheckReport(dir);
    if (!report) throw new Error(`check produced no parseable report in ${dir}`);
    parsed = parseCheckJson(fs.readFileSync(report, 'utf8'));
    source = path.relative(dir, report);
  }
  console.log(`\ncheck: ${parsed.errors} error(s), ${parsed.warnings} warning(s) — from ${source}`);
  if (parsed.errors > 0) {
    console.log(checkRun.out.slice(-6000));
    process.exit(2);
  }

  const start = arg('start', '0');
  const end = arg('end', '7');
  console.log(`\nrender: ${start}s -> ${end}s at ${fps}fps`);
  const renderOut = run(
    `${cli} render . -o proof.mp4 --quality looks --fps ${fps} --start ${start} --end ${end}`,
    dir,
  );
  console.log(renderOut.trim().split(/\r?\n/).slice(-6).join('\n'));

  const probe = JSON.parse(
    bashScript(
      `ffprobe -v error -show_entries stream=codec_name,width,height,nb_frames -show_entries format=duration,size -of json "${path.join(dir, 'proof.mp4')}"`,
    ),
  );
  console.log(`\nproof.mp4: ${JSON.stringify(probe.format)} ${JSON.stringify(probe.streams?.[0] ?? {})}`);

  const frames = path.join(dir, 'frames');
  fs.mkdirSync(frames, { recursive: true });
  const at = ['0.20', '1.10', '2.20', '3.40', '4.60', '6.20'];
  for (const second of at) {
    const target = path.join(frames, `f${second.replace('.', '_')}.png`);
    bashScript(
      `ffmpeg -y -v error -ss ${second} -i "${path.join(dir, 'proof.mp4')}" -frames:v 1 "${target}"`,
    );
  }
  console.log(`frames: ${at.map((s) => `f${s.replace('.', '_')}.png`).join(' ')}`);
  console.log(`\nDONE — ${path.join(dir, 'proof.mp4')}`);
}

const reuseDir = arg('reuse', '');
if (reuseDir) {
  console.log(`reusing project: ${reuseDir}`);
  inspect(reuseDir, 30);
} else {
  main();
}
