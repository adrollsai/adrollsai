/**
 * LIVE PROOF for the `reverse` skill — a WORKING SET, not a deliverable. Read this
 * before trusting a frame.
 *
 * What is REAL here: the reference film is a delivered 1080×1920 film that exists on
 * this machine; the measurements come from ffprobe/ffmpeg run against it; the plates
 * are the reference's own shots, cut out of it; the voice is the reference's own
 * audio, sliced at the measured onsets; the project is the one the `video` skill's own
 * emitter produces; the check and the render are the pinned CLI.
 *
 * What is a STAND-IN, and is labelled as one wherever it appears:
 *
 *   - ON-SCREEN COPY. The reference's words cannot be read (no OCR in this pipeline),
 *     so every line is the marked blank `WORD WORD` — sized from the measured type box
 *     and from how long the measured voice holds it. A rebuild render therefore shows
 *     WHERE type sits, never WHAT it said.
 *   - THE END CARD. `BRAND UNKNOWN`, `TAGLINE UNKNOWN`, `ADDRESS UNKNOWN` and
 *     placeholder digits, because `parseBeats` requires a card and this pipeline has
 *     nothing real to put in it.
 *   - THE SPAN. A full-length render is ~25-30 minutes; this renders the first
 *     `--end` seconds (default 9) and compares only inside that window.
 *
 * Everything is written under D:\nobo-renders\reverse (C: has ~2.3 GB free against a
 * ~2 GB render threshold) with TEMP/TMPDIR on D:\nobo-tmp.
 *
 *   node scripts/reverse-live-proof.ts                       # analysis + rebuild + render + compare
 *   node scripts/reverse-live-proof.ts --analyse-only        # measure, write SPEC, stop
 *   node scripts/reverse-live-proof.ts --no-render           # everything up to `check`
 *   node scripts/reverse-live-proof.ts --reuse <dir>         # re-compare an existing render
 *   node scripts/reverse-live-proof.ts --reference <file>    # another film
 */
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  frameArgs,
  logFilterArgs,
  probeArgs,
  audioFilterArgs,
  type AnalysisTools,
} from '../lib/agent/tools/skills/reverse/analyse';
import { reverseFiles, reverseSkill, estimateReverseCredits, openQuestions } from '../lib/agent/tools/skills/reverse/index';
import { voiceSlices } from '../lib/agent/tools/skills/reverse/rebuild';
import {
  compareBeats,
  compareRuntime,
  contactSheetArgs,
  describeComparison,
  framePairs,
  meanAbsoluteDifference,
  type DifferenceScore,
} from '../lib/agent/tools/skills/reverse/compare';
import { PROJECT_CLI_VERSION } from '../lib/agent/tools/skills/video/emit';

const ROOT = process.env.NOBO_RENDER_ROOT || 'D:\\nobo-renders';
const TMP = process.env.NOBO_TMP_ROOT || 'D:\\nobo-tmp';
const BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';
const FONT = 'C\\:/Windows/Fonts/arialbd.ttf';
const DEFAULT_REFERENCE =
  'C:\\Users\\Adrolls\\Desktop\\Nobo Native App\\gnr-homes-tricity\\renders\\gnr-homes-tricity-9x16-corporate.mp4';

/** POSIX form of a Windows path, for the Git Bash invocations. */
const posix = (p: string) => p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : String(process.argv[index + 1] ?? fallback);
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const env = { ...process.env, TEMP: TMP, TMP, TMPDIR: TMP };

function bashScript(script: string, cwd?: string): string {
  fs.mkdirSync(TMP, { recursive: true });
  const file = path.join(TMP, `reverse-${process.pid}-${seq++}.sh`);
  fs.writeFileSync(file, script.replace(/\r\n/g, '\n'), 'utf8');
  const out = execFileSync(BASH, [file], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    env: { ...env, TMPDIR: posix(TMP) },
  });
  return String(out);
}

let seq = 0;

/** Run ffmpeg/ffprobe with an ARGUMENT ARRAY: no shell, so no quoting to get wrong. */
function tool(
  bin: string,
  args: string[],
  origin: string,
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.error) throw new Error(`${origin}: ${bin} could not run (${result.error.message})`);
  return { code: result.status ?? 1, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') };
}

/** The process seams `analyseVideo` wants, wired to the real binaries. */
function localTools(): AnalysisTools {
  fs.mkdirSync(TMP, { recursive: true });
  return {
    async probeJson(file) {
      const out = tool('ffprobe', probeArgs(file), 'probe');
      if (out.code !== 0) throw new Error(`ffprobe failed for ${file}: ${out.stderr.slice(0, 400)}`);
      return out.stdout;
    },
    async log(file, filter, kind) {
      const args = kind === 'video' ? logFilterArgs(file, filter) : audioFilterArgs(file, filter);
      const out = tool('ffmpeg', args, 'filter-log');
      // ffmpeg logs the measurement to STDERR and exits 0; a non-zero exit is still a
      // result to be read, never a reason to invent one.
      return `${out.stdout}\n${out.stderr}`;
    },
    async frameRgb(file, at, width, height) {
      const target = path.join(TMP, `rev-${process.pid}-${seq++}.raw`);
      const out = tool('ffmpeg', frameArgs(file, at, width, height, target), 'frame');
      if (!fs.existsSync(target)) throw new Error(`ffmpeg wrote no frame at ${at}s: ${out.stderr.slice(0, 300)}`);
      const bytes = fs.readFileSync(target);
      fs.rmSync(target, { force: true });
      return new Uint8Array(bytes);
    },
  };
}

const f2 = (value: number) => Number(value).toFixed(2);

async function main(): Promise<void> {
  fs.mkdirSync(TMP, { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'reverse'), { recursive: true });

  const reference = arg('reference', DEFAULT_REFERENCE);
  if (!fs.existsSync(reference)) throw new Error(`no reference film at ${reference}`);

  // ── 1. measure, and say what was measured
  const started = Date.now();
  const result = await reverseSkill(
    {
      file: reference,
      extraBans: [
        'No copy that the reference frame does not carry: this rebuild places type where it was measured and ' +
          'leaves the words blank.',
      ],
    },
    localTools(),
  );
  const { analysis, rebuild } = result;
  console.log(`\n=== MEASURED: ${analysis.facts.basename} ===`);
  console.log(
    `container : ${analysis.facts.width}x${analysis.facts.height} ${analysis.facts.fps}fps ` +
      `${analysis.facts.durationSeconds}s = ${analysis.facts.frameCount} frames, ` +
      `audio ${analysis.facts.hasAudio ? `${analysis.facts.audioCodec} ${analysis.facts.sampleRate}Hz` : 'NONE'}`,
  );
  console.log(`shots     : ${analysis.film.shotCount} (threshold ${analysis.sceneThreshold}, ${analysis.droppedBoundaries.length} boundary(ies) dropped)`);
  console.log(`palette   : ${analysis.film.palette.map((s) => `${s.hex} ${s.sharePercent}%`).join(', ')}`);
  console.log(`type      : ${analysis.film.textBoxCount} candidate box(es) in ${analysis.film.typeShotCount} shot(s), band y ${analysis.film.typeTopPx}-${analysis.film.typeBottomPx}px`);
  console.log(`voice     : ${analysis.vo.reason}`);
  for (const rung of analysis.vo.ladder) {
    console.log(
      `    ${String(rung.db).padStart(4)}dB → ${rung.blocks} block(s), ${rung.speechSeconds}s speech, ` +
        `${rung.alignedBlocks} on a cut, median ${rung.medianBlockSeconds}s`,
    );
  }
  console.log(`alignment : ${analysis.alignment.aligned.length} aligned, ${analysis.alignment.unaligned.length} reported off-grid`);
  for (const shot of analysis.shots) {
    console.log(
      `  ${shot.id} ${f2(shot.start)}-${f2(shot.end)} (${f2(shot.dur)}s) luma ${shot.meanLuma} ` +
        `type ${shot.textBoxes.length} ${shot.textBoxes.map((b) => `[${b.x},${b.y} ${b.width}x${b.height}]`).join(' ')}`,
    );
  }
  console.log(`\n${result.briefing}`);
  console.log(`spec audit: ${result.audit.figures} figures, ${result.audit.invented.length} unaccounted`);

  // ── 2. write the working set
  const dir = path.join(ROOT, 'reverse', result.rebuild.raw.jobId as string);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'assets', 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets', 'voice'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });

  for (const file of reverseFiles(result)) {
    const target = path.join(dir, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content);
  }
  console.log(`\nwrote ${reverseFiles(result).length} files to ${dir}`);
  console.log(`  SPEC.md ${fs.statSync(path.join(dir, 'SPEC.md')).size} bytes`);
  console.log(`  beats.json ${fs.statSync(path.join(dir, 'beats.json')).size} bytes`);
  console.log(`  timing.json total ${rebuild.timing.total}s over ${Object.keys(rebuild.timing.sceneList).length} scenes`);
  for (const note of result.notes) console.log(`  · ${note}`);
  console.log(`credits: ${estimateReverseCredits().detail}`);
  for (const question of openQuestions(analysis)) console.log(`  ? ${question}`);

  if (flag('analyse-only')) {
    console.log(`\nstopped after the measurement (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    return;
  }

  // ── 3. the plates: the reference's own shots, cut out of it
  const aspect = analysis.facts;
  for (const shot of analysis.shots) {
    const out = path.join(dir, 'assets', 'src', `${shot.id}.mp4`);
    const cut = tool(
      'ffmpeg',
      [
        '-y', '-v', 'error',
        '-ss', String(shot.start),
        '-i', reference,
        '-t', String(shot.dur),
        '-an',
        '-vf', `scale=${aspect.width}:${aspect.height}:force_original_aspect_ratio=increase,crop=${aspect.width}:${aspect.height}`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-r', String(rebuild.beats.fps),
        out,
      ],
      'plate',
    );
    if (cut.code !== 0) throw new Error(`could not cut ${shot.id}: ${cut.stderr.slice(0, 400)}`);
  }
  console.log(`\nplates: ${analysis.shots.length} shots cut from the reference into assets/src`);

  // ── 4. the voice: the reference's own audio, sliced at the measured onsets
  const slices = voiceSlices(analysis, rebuild.raw);
  for (const slice of slices) {
    const out = path.join(dir, 'assets', 'voice', `${slice.id}.wav`);
    const cut = tool(
      'ffmpeg',
      ['-y', '-v', 'error', '-ss', String(slice.start), '-t', String(slice.dur), '-i', reference, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', out],
      'voice',
    );
    if (cut.code !== 0) throw new Error(`could not slice ${slice.id}: ${cut.stderr.slice(0, 400)}`);
  }
  console.log(`voice : ${slices.length} measured onset(s) sliced out of the reference's own audio`);

  // ── 5. the project's own grading pass (ffmpeg grade + per-scene plate copies)
  const gradeOut = bashScript(`cd '${posix(dir)}' && FFMPEG=ffmpeg sh grading.sh 2>&1`);
  console.log(`grading.sh: ${gradeOut.trim().split(/\r?\n/).slice(-1)[0]}`);

  if (flag('no-render')) {
    console.log('\nstopped before check (--no-render)');
    return;
  }

  // ── 6. check: zero errors or no render
  const cli = `npx --yes hyperframes@${PROJECT_CLI_VERSION}`;
  const check = spawnSync(`${cli} check --json`, { cwd: dir, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024, env });
  const checkText = `${check.stdout ?? ''}\n${check.stderr ?? ''}`;
  let errors = -1;
  let warnings = -1;
  try {
    const json = JSON.parse(checkText.slice(checkText.indexOf('{'), checkText.lastIndexOf('}') + 1));
    const sections = Object.values(json as Record<string, unknown>).filter(
      (value): value is Record<string, number> => typeof value === 'object' && value !== null && 'errorCount' in (value as object),
    );
    errors = sections.length ? sections.reduce((sum, s) => sum + Number(s.errorCount ?? 0), 0) : Number((json as any).errors ?? -1);
    warnings = sections.length ? sections.reduce((sum, s) => sum + Number(s.warningCount ?? 0), 0) : Number((json as any).warnings ?? -1);
  } catch {
    fs.writeFileSync(path.join(dir, 'check-output.txt'), checkText);
    console.log('\ncheck output could not be parsed as JSON; written to check-output.txt');
    console.log(checkText.slice(-3000));
  }
  console.log(`\ncheck: ${errors} error(s), ${warnings} warning(s)`);
  if (errors !== 0) {
    console.log(checkText.slice(-6000));
    throw new Error(`check reported ${errors} error(s) — refusing to render`);
  }

  // ── 7. render a SPAN (a full-length render is ~25-30 min)
  const end = arg('end', '9');
  console.log(`\nrender: first ${end}s at ${rebuild.beats.fps}fps`);
  const renderAt = Date.now();
  const render = spawnSync(
    `${cli} render . -o out.mp4 --quality looks --fps ${rebuild.beats.fps} --start 0 --end ${end}`,
    { cwd: dir, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024, env },
  );
  const renderText = `${render.stdout ?? ''}\n${render.stderr ?? ''}`;
  console.log(renderText.trim().split(/\r?\n/).slice(-6).join('\n'));
  const out = path.join(dir, 'out.mp4');
  if (!fs.existsSync(out)) throw new Error(`render produced no out.mp4 in ${dir}`);
  const probe = JSON.parse(
    tool('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size', '-show_entries', 'stream=codec_type,width,height,nb_frames', '-of', 'json', out], 'probe').stdout,
  );
  const rebuildSeconds = Number(probe.format?.duration ?? 0);
  console.log(`out.mp4: ${JSON.stringify(probe.format)} (${((Date.now() - renderAt) / 1000).toFixed(0)}s to render)`);

  // ── 8. compare: runtime, beats, and frames side by side
  const runtime = compareRuntime(Number(end), Number(Math.min(rebuildSeconds, Number(end))));
  const beatsCmp = compareBeats(analysis.vo.spans.length, rebuild.beats.beats.filter((b) => b.vo.length > 0).length);
  console.log(`\ncomparison (inside the rendered span):`);
  console.log(`  ${runtime.verdict}`);
  console.log(`  ${beatsCmp.verdict} (measured onsets vs spoken beats in beats.json)`);
  console.log(
    `  whole-film expectation: reference ${analysis.facts.durationSeconds}s vs rebuild ${rebuild.timing.total}s ` +
      `(${f2(rebuild.timing.total - analysis.facts.durationSeconds)}s) — only the span above was rendered`,
  );

  const pairs = framePairs(Math.min(Number(end), rebuildSeconds), rebuildSeconds, Number(arg('pairs', '6')));
  const cellWidth = 270;
  const cellHeight = 480;
  const rows: { reference: string; rebuild: string; label: string }[] = [];
  const scores: DifferenceScore[] = [];
  for (const pair of pairs) {
    const refPng = path.join(dir, 'frames', `ref-${f2(pair.at).replace('.', '_')}.png`);
    const rebPng = path.join(dir, 'frames', `rebuild-${f2(pair.rebuildAt).replace('.', '_')}.png`);
    for (const [file, at, target] of [
      [reference, pair.at, refPng],
      [out, pair.rebuildAt, rebPng],
    ] as const) {
      const got = tool(
        'ffmpeg',
        ['-y', '-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', `scale=${cellWidth}:${cellHeight}`, target],
        'frame',
      );
      if (got.code !== 0) throw new Error(`could not pull a frame at ${at}s: ${got.stderr.slice(0, 300)}`);
    }
    const a = tool('ffmpeg', ['-y', '-v', 'error', '-ss', String(pair.at), '-i', reference, '-frames:v', '1', '-vf', `scale=${cellWidth}:${cellHeight}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', path.join(TMP, 'a.raw')], 'frame');
    const b = tool('ffmpeg', ['-y', '-v', 'error', '-ss', String(pair.rebuildAt), '-i', out, '-frames:v', '1', '-vf', `scale=${cellWidth}:${cellHeight}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', path.join(TMP, 'b.raw')], 'frame');
    void a;
    void b;
    const score = meanAbsoluteDifference(
      new Uint8Array(fs.readFileSync(path.join(TMP, 'a.raw'))),
      new Uint8Array(fs.readFileSync(path.join(TMP, 'b.raw'))),
    );
    scores.push(score);
    rows.push({ reference: refPng, rebuild: rebPng, label: `${f2(pair.at)}s diff ${score.percent}%` });
  }

  const sheet = path.join(dir, 'contact-sheet.png');
  const sheetRun = spawnSync('ffmpeg', contactSheetArgs({ pairs: rows, out: sheet, width: cellWidth, height: cellHeight, fontFile: FONT, fontSize: 20 }), {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (sheetRun.status !== 0) console.log(`contact sheet failed: ${String(sheetRun.stderr).slice(0, 600)}`);

  const manifest = {
    reference,
    referenceSeconds: analysis.facts.durationSeconds,
    rebuildSeconds,
    renderedSpanSeconds: Number(end),
    runtime: compareRuntime(Number(end), Number(Math.min(rebuildSeconds, Number(end)))),
    beats: beatsCmp,
    pairs: rows.map((row, index) => ({ ...row, at: pairs[index].at, rebuildAt: pairs[index].rebuildAt, difference: scores[index] })),
    contactSheet: sheet,
  };
  fs.writeFileSync(path.join(dir, 'comparison.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`\n  ${describeComparison(manifest.runtime, beatsCmp, scores)}`);
  for (const [index, row] of rows.entries()) {
    console.log(`  ${row.label.padEnd(22)} mad ${scores[index].meanAbsolute.toFixed(2)}/255  psnr ${scores[index].psnrDb}dB`);
  }
  console.log(`\ncontact sheet: ${sheet}`);
  console.log(`project:       ${dir}`);
  console.log(`elapsed:       ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

main().catch((error) => {
  console.error(`\nFAILED: ${error?.message ?? error}`);
  process.exit(1);
});
