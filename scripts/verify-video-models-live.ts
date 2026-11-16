/**
 * Do the video models actually deliver FOOTAGE, VOICE and MUSIC into one file?
 *
 * Objective item 3 asks the video path to use Grok Imagine footage, TTS and music, and to report
 * wall-clock. The delivered film proved TTS and composition; it used the academy's own stills and
 * had no bed, so two of the three were unproven. Reading the tool schemas is not proof either —
 * this repo has already shipped a "live" page URL that 404'd and a template send that never sent.
 *
 * So this calls the REAL tools through the REAL orchestrator, walking the REAL review gate for each
 * billable step, then does the edit in the sandbox and probes the finished file:
 *
 *   generate_grok_video  image-to-video over the catalogue photograph  -> a moving clip
 *   generate_voiceover   the ad read                                    -> narration
 *   ffmpeg               synthesised royalty-free bed + duck + mux      -> one file with both streams
 *
 * Every stage is timed, because "minutes not hours" is a claim about numbers.
 *
 * Costs: one Grok clip and one TTS read on the Procolor account. No ad spend, nothing published.
 *
 *   npx esbuild scripts/verify-video-models-live.ts --bundle --platform=node --format=esm \
 *     --packages=external --outfile=.tmp-video-models.mjs && node .tmp-video-models.mjs
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';
import { executeInE2BSandbox } from '../lib/agent/sandbox';

dotenv.config({ path: '.env.local', quiet: true });
if (!process.env.E2B_TEMPLATE) process.env.E2B_TEMPLATE = 'nobogent-media';

const ORG = '9c0748de-e3da-4ea1-b323-4ce736b5ca7c'; // Procolor
const PRODUCT = 'cd40f892-81bc-4712-a40d-ac3163588628'; // Diploma in Cinematography

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
};

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

const timings: Record<string, number> = {};

/** Run a gated tool: expect the refusal, grant it the way the UI does, then run it for real. */
async function callGated(tools: any, name: string, args: any, label: string): Promise<any> {
  const tool = tools[name];
  if (!tool?.execute) throw new Error(`${name} is not registered`);

  const refused = await tool.execute(args, {} as any);
  if (refused?.needs_review !== true) {
    // Nothing to approve — it ran straight through.
    return refused;
  }
  const actionId = String(refused.actionId ?? '');
  console.log(`  ${label}: refused as expected (${actionId}), approving…`);

  const row = await sb
    .from('agent_events')
    .select('id, payload')
    .eq('user_id', ORG)
    .eq('event_type', 'PENDING_ACTION_APPROVAL')
    .eq('payload->>actionId', actionId)
    .maybeSingle();
  const rowId = (row.data as any)?.id ?? null;
  if (!rowId) throw new Error(`no approval row recorded for ${actionId}`);

  const recorded = (row.data as any)?.payload?.actionPayload ?? {};
  check(`  ${label} card carries the tool's real arguments`, Object.keys(recorded).length > 0,
    JSON.stringify(recorded).slice(0, 110));

  await sb.from('agent_events').update({ status: 'approved' }).eq('id', rowId);

  const started = Date.now();
  // approvalId AND the arguments: the schema requires its fields, the gate uses the stored payload.
  const result = await tool.execute({ ...args, approvalId: actionId }, {} as any);
  timings[label] = Math.round((Date.now() - started) / 1000);

  await sb.from('agent_events').delete().eq('id', rowId);
  return result;
}

// The product photograph is real, public, and the thing an ad for this course should move.
const product = await sb
  .from('properties')
  .select('id, title, image_url, images')
  .eq('id', PRODUCT)
  .maybeSingle();
const photo: string =
  (product.data as any)?.image_url ?? ((product.data as any)?.images ?? [])[0] ?? '';
check('the catalogue photograph exists to animate', /^https?:\/\//.test(photo), photo.slice(0, 90));

const ctx = await createAgentContext(sb as any, ORG, {
  intentText: 'make a 15 second video ad with a voiceover and music for the Diploma in Cinematography',
});
const tools = ctx.tools as any;
check('the media group loads the generation tools',
  Boolean(tools.generate_grok_video && tools.generate_voiceover && tools.sandbox_render_hyperframes),
  ctx.toolGroups.join(','));

// ── 1. FOOTAGE: animate the real photograph.
console.log('\n▸ generate_grok_video (image-to-video over the catalogue photo)');
const clip = await callGated(
  tools,
  'generate_grok_video',
  {
    prompt:
      'Slow cinematic push-in on a student crew filming on a rooftop at golden hour, gimbal camera gliding, ' +
      'LED panel flare, warm rim light, shallow depth of field, subtle handheld energy, photorealistic, 35mm.',
    imageUrls: [photo],
    aspectRatio: '9:16',
    resolution: '720p',
    durationSeconds: 8,
    title: 'Gate check — cinematography B-roll',
  },
  'grok',
);
console.log(`  -> ${JSON.stringify(clip).slice(0, 500)}`);
check('Grok returned a real clip', clip?.success === true && /^https?:\/\//.test(String(clip.videoUrl ?? clip.url ?? '')),
  String(clip?.videoUrl ?? clip?.url ?? clip?.error ?? ''));
const clipUrl = String(clip?.videoUrl ?? clip?.url ?? '');

// ── 2. VOICE: the read.
console.log('\n▸ generate_voiceover');
const voiceScript =
  'Fifteen thousand off our November batch. Eight weeks, hands on. Cinema cameras, gimbals, LED lighting, ' +
  'and mentors who actually work in the industry. Applications close November thirtieth. ' +
  'Call nine five six nine nine, one nine nine eight five.';
const voice = await callGated(
  tools,
  'generate_voiceover',
  { script: voiceScript, voiceName: 'Aoede', language: 'english', title: 'Gate check — ad read' },
  'tts',
);
console.log(`  -> ${JSON.stringify(voice).slice(0, 400)}`);
const voiceUrl = String(voice?.audioUrl ?? voice?.url ?? voice?.mp3Url ?? '');
check('TTS returned a real audio file', voice?.success === true && /^https?:\/\//.test(voiceUrl), voiceUrl);

// ── 3. MUSIC + EDIT: synthesise the bed, duck it under the voice, mux over the clip.
console.log('\n▸ sandbox: bed + mix');
const bedExpr =
  "'0.10*sin(2*PI*220*t)+0.075*sin(2*PI*277.18*t)+0.065*sin(2*PI*329.63*t)+0.02*sin(2*PI*880*t+sin(2*PI*0.2*t))'";
const script = [
  'set -euo pipefail',
  'mkdir -p cut && cd cut',
  `curl -fsSL -A "Mozilla/5.0" "${clipUrl}" -o clip.mp4`,
  `curl -fsSL -A "Mozilla/5.0" "${voiceUrl}" -o vo.mp3`,
  'ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 clip.mp4 | head -1 > clipdur.txt',
  'echo "--- clip ---" && ffprobe -v error -show_entries stream=codec_type,width,height,duration -of default=noprint_wrappers=1 clip.mp4',
  'echo "--- voice ---" && ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1 vo.mp3',
  // A 15s picture bed from the clip, and the synthesised music.
  `ffmpeg -hide_banner -loglevel error -y -stream_loop -1 -i clip.mp4 -t 15 -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30" -an -c:v libx264 -pix_fmt yuv420p -crf 20 pic.mp4`,
  `ffmpeg -hide_banner -loglevel error -y -f lavfi -i "aevalsrc=${bedExpr}:s=48000:d=15" -af "tremolo=f=0.12:d=0.35,lowpass=f=2200,volume=0.55" -c:a aac -b:a 160k bed.m4a`,
  // Voice at full, music ducked to ~0.22, mixed and normalised, muxed over the picture.
  'ffmpeg -hide_banner -loglevel error -y -i pic.mp4 -i vo.mp3 -i bed.m4a -filter_complex "[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=1.0[voice];[2:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.22[music];[voice][music]amix=inputs=2:duration=first:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11[a]" -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest final.mp4',
  'echo "--- final ---" && ffprobe -v error -show_entries stream=codec_type,codec_name,width,height -show_entries format=duration,size -of default=noprint_wrappers=1 final.mp4',
  'echo "--- final loudness ---" && ffmpeg -hide_banner -i final.mp4 -af volumedetect -f null - 2>&1 | grep -E "mean_volume|max_volume" || true',
  'echo DONE',
].join('\n');

const bedStarted = Date.now();
const mix = await executeInE2BSandbox({
  userId: ORG,
  command: 'bash cut/make.sh',
  files: [{ path: 'cut/make.sh', content: script }],
  readFiles: ['cut/final.mp4'],
  timeoutMs: 280_000,
});
timings.mix = Math.round((Date.now() - bedStarted) / 1000);
console.log(mix.stdout.slice(0, 1800));
if (!mix.success) console.log('stderr:', mix.stderr.slice(0, 600));

check('the sandbox edit succeeded', mix.success === true, `exit ${mix.exitCode} in ${timings.mix}s`);
check('the final file has a video stream', /codec_type=video/.test(mix.stdout));
check('the final file has an audio stream', /codec_type=audio/.test(mix.stdout));
const mean = Number((/mean_volume:\s*(-?[\d.]+) dB/.exec(mix.stdout) ?? [])[1]);
check('the delivered audio is not silence', Number.isFinite(mean) && mean > -40, `mean ${mean} dB`);

// The clip is ~8s and the film is 15s, so a 15s output proves the footage was actually extended and
// used — not that a colour card stood in for it. Read the durations from their own sections rather
// than the first number in the log, which is how this check previously passed for the wrong reason.
const clipDur = Number((/--- clip ---[\s\S]*?duration=([\d.]+)/.exec(mix.stdout) ?? [])[1]);
const finalDur = Number((/--- final ---[\s\S]*?duration=([\d.]+)/.exec(mix.stdout) ?? [])[1]);
check(
  'the Grok footage was used and extended to the film length',
  Number.isFinite(clipDur) && Number.isFinite(finalDur) && finalDur >= 14.5 && clipDur < 12,
  `clip ${clipDur}s → final ${finalDur}s`,
);

const finalUrl = (mix.uploadedFiles ?? {})['cut/final.mp4'];
check('the finished film was published', Boolean(finalUrl), String(finalUrl ?? '').slice(0, 100));

console.log(`\n${'='.repeat(64)}`);
console.log('=== WALL CLOCK');
let total = 0;
for (const [label, seconds] of Object.entries(timings)) {
  total += seconds;
  console.log(`  ${label.padEnd(8)} ${seconds}s`);
}
console.log(`  ${'TOTAL'.padEnd(8)} ${total}s (${(total / 60).toFixed(1)} min)`);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
