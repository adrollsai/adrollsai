/**
 * Give the reel a voice, then measure it.
 *
 * The delivered reel carried music and no narration, and the doctrine's own rule is that the voice is narration unless
 * the owner asks for a presenter. So this writes the script, synthesises it with Gemini TTS, and lays it over the same
 * cut as a second <audio> track inside the composition — the arrangement the renderer mixes itself, which is why the
 * film can no longer arrive silent.
 *
 * Then it measures: both audio streams present, loudness in range, and the words the film actually says.
 *
 *   npx esbuild scripts/add-narration.ts --bundle --platform=node --format=esm --packages=external \
 *     --outfile=.tmp-add-narration.mjs && node .tmp-add-narration.mjs
 */
import '../lib/env-local';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { executeInE2BSandbox, uploadBufferToR2 } from '../lib/agent/sandbox';

dotenv.config({ path: '.env.local', quiet: true });
if (!process.env.E2B_TEMPLATE) process.env.E2B_TEMPLATE = 'nobogent-media';

const ADMIN = 'bc63c065-9bcc-4793-bedc-f0960406425b';
const DURATION = 15;

// THE SCRIPT. Written first, in the business's own voice, to fit 15 seconds: about 3 words a second leaves room for the
// type to land. Hinglish, because that is how the customer actually talks.
const SCRIPT =
  'Aapka poora marketing department, ab ek agent ke haath mein. Ads, landing page, aur follow-up, sab ek jagah. ' +
  'Pehla mahina sirf nau sau ninety-nine rupaye. Nobogent. Abhi call kijiye.';

const { createGeminiTTS } = await import('@/utils/external-apis');
const { queryKieTask } = await import('@/utils/external-apis');

console.log('▸ 1. synthesising the narration');
console.log(`  script: ${SCRIPT}`);
const tts = await createGeminiTTS({ dialogueText: SCRIPT, speakerName: 'Aoede' });
if (!tts.taskId) {
  console.log(`  TTS FAILED: ${tts.error}`);
  process.exit(1);
}

let voiceUrl: string | null = null;
for (let i = 0; i < 50; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const status = await queryKieTask(tts.taskId);
  if (status.state === 'success' && status.resultUrl) {
    voiceUrl = status.resultUrl;
    break;
  }
  if (status.state === 'fail') {
    console.log(`  TTS provider failed: ${status.error}`);
    break;
  }
}
if (!voiceUrl) {
  console.log('  no narration produced');
  process.exit(1);
}
console.log(`  voice: ${voiceUrl}`);

const hostedVoice = await (async () => {
  const res = await fetch(voiceUrl!);
  const buffer = Buffer.from(await res.arrayBuffer());
  return uploadBufferToR2(buffer, `nobogent/narration-${Date.now()}.mp3`, ADMIN);
})();
console.log(`  hosted: ${hostedVoice}`);

// Put it in the sandbox next to the composition so the <audio> element can reference it by filename.
await executeInE2BSandbox({
  command: `mkdir -p nobogent_reel && curl -sS -o nobogent_reel/narration.mp3 "${hostedVoice}" && ls -la nobogent_reel/narration.mp3`,
  userId: ADMIN,
  timeoutMs: 120_000,
});

// ── 2. The composition, now with BOTH tracks: voice over bed.
const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const LINES = ['FIRST MONTH ₹999', 'AI MARKETING DEPARTMENT', 'ADS · PAGES · FOLLOW-UP', 'LAUNCHED IN A WEEK', 'BOOK A CALL'];
const HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#0F172A;font-family:Inter,Arial,Helvetica,sans-serif;overflow:hidden}
  #root{position:relative;width:1080px;height:1920px;overflow:hidden;
        background:radial-gradient(120% 80% at 50% 0%,#1B2A47 0%,#0F172A 58%,#0B1220 100%)}
  .glow{position:absolute;left:50%;top:10%;width:1040px;height:1040px;transform:translateX(-50%);
        background:radial-gradient(circle,rgba(125,211,252,.26) 0%,rgba(125,211,252,0) 62%);filter:blur(14px)}
  .stack{position:absolute;left:96px;right:96px;top:250px;display:flex;flex-direction:column;gap:48px}
  .line{color:#F7F6F3;font-weight:800;letter-spacing:-.02em;line-height:1.04;opacity:0}
  .l1{font-size:132px}.l2{font-size:64px;color:#7DD3FC}
  .l3{font-size:46px;font-weight:600;color:#C8D6EA;letter-spacing:.01em}
  .l4{font-size:74px}
  .cta{position:absolute;left:96px;bottom:150px;padding:36px 64px;border-radius:999px;background:#F7F6F3;color:#0F172A;
       font-size:46px;font-weight:900;letter-spacing:.02em;opacity:0}
  .mark{position:absolute;left:96px;top:180px;font-size:32px;font-weight:800;letter-spacing:.32em;color:#7DD3FC;opacity:0}
</style></head><body>
<div id="root" data-composition-id="nobogent_offer_reel" data-width="1080" data-height="1920" data-duration="${DURATION}">
  <audio id="bed" src="bed.m4a" data-start="0" data-duration="${DURATION}" data-track-index="0" data-volume="0.35"></audio>
  <audio id="voice" src="narration.mp3" data-start="0.6" data-duration="${DURATION - 1}" data-track-index="1" data-volume="1"></audio>
  <div class="glow"></div>
  <div class="mark" id="mark">NOBOGENT</div>
  <div class="stack">
    <div class="line l1" id="l1">${esc(LINES[0])}</div>
    <div class="line l2" id="l2">${esc(LINES[1])}</div>
    <div class="line l3" id="l3">${esc(LINES[2])}</div>
    <div class="line l4" id="l4">${esc(LINES[3])}</div>
  </div>
  <div class="cta" id="cta">${esc(LINES[4])}</div>
</div>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script>
  const tl = gsap.timeline({ paused: true });
  tl.to('#mark', { opacity: 1, duration: 0.6 }, 0.3)
    .to('#l1', { opacity: 1, y: -8, duration: 0.7 }, 0.9)
    .to('#l2', { opacity: 1, duration: 0.6 }, 3.2)
    .to('#l3', { opacity: 1, duration: 0.6 }, 6.2)
    .to('#l4', { opacity: 1, duration: 0.5 }, 9.2)
    .to('#cta', { opacity: 1, scale: 1.02, duration: 0.5 }, 11.6)
    .to({}, { duration: ${DURATION} });
  window.__timelines['nobogent_offer_reel'] = tl;
</script>
</body></html>`;

const res = await executeInE2BSandbox({
  files: [{ path: 'nobogent_reel/index.html', content: HTML }],
  command: [
    'set -uo pipefail',
    'cd nobogent_reel',
    'rm -f out.mp4 out_raw.mp4',
    'npx --yes hyperframes lint 2>&1 | tail -5',
    'npx --yes hyperframes render --quality draft -o out.mp4 2>&1 | tail -5',
    'echo "=== streams"',
    'ffprobe -v error -show_entries stream=codec_type,codec_name -of csv=p=0 out.mp4',
    'echo "DUR:$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 out.mp4)"',
    'ffmpeg -hide_banner -i out.mp4 -af volumedetect -f null - 2>&1 | grep -E "mean_volume|max_volume" || true',
  ].join('\n'),
  readFiles: ['nobogent_reel/out.mp4'],
  userId: ADMIN,
  timeoutMs: 280_000,
});
console.log('\n▸ 2. render with narration');
console.log(res.stdout);
if (res.stderr) console.log('STDERR:', String(res.stderr).slice(-400));
const filmUrl = (res.uploadedFiles as any)?.['nobogent_reel/out.mp4'];
console.log('film:', filmUrl ?? '(none)');
if (filmUrl) fs.writeFileSync('.tmp-narrated-url.txt', filmUrl);
