/**
 * Rebuild the Nobogent reel so it actually passes QA: real render, real audio stream, measured.
 *
 * The delivered reel had ONE h264 stream — no narration, no music — and passed through every gate because nothing
 * looked at the file. This runs the whole thing in a single sandbox session so the composition, the render, the audio
 * bed, the mux and the measurement all apply to the same bytes:
 *
 *   1. lint                     the renderer's cheap structural pass
 *   2. render --quality draft   a real encode of the fixed (flow-layout) composition
 *   3. synthesise a music bed   ffmpeg lavfi, the tested command from the media doctrine, no licence problem
 *   4. mux                      video stream copied, audio encoded, shortest
 *   5. MEASURE                  ffprobe streams + volumedetect, because the film is not narrated until the file says so
 *
 *   npx esbuild scripts/rebuild-nobogent-reel.ts --bundle --platform=node --format=esm --packages=external \
 *     --outfile=.tmp-rebuild-reel.mjs && node .tmp-rebuild-reel.mjs
 */
import fs from 'node:fs';
import dotenv from 'dotenv';
import { executeInE2BSandbox } from '../lib/agent/sandbox';

dotenv.config({ path: '.env.local', quiet: true });
if (!process.env.E2B_TEMPLATE) process.env.E2B_TEMPLATE = 'nobogent-media';

const ADMIN = 'bc63c065-9bcc-4793-bedc-f0960406425b';
const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The copy is the offer, nothing else. One message per frame is the whole discipline of an offer reel.
const LINES = ['FIRST MONTH ₹999', 'AI MARKETING DEPARTMENT', 'ADS · PAGES · FOLLOW-UP', 'LAUNCHED IN A WEEK', 'BOOK A CALL'];
const DURATION = 15;

const HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#0F172A;font-family:Inter,Arial,Helvetica,sans-serif;overflow:hidden}
  #root{position:relative;width:1080px;height:1920px;overflow:hidden;
        background:radial-gradient(120% 80% at 50% 0%,#1B2A47 0%,#0F172A 58%,#0B1220 100%)}
  .glow{position:absolute;left:50%;top:10%;width:1040px;height:1040px;transform:translateX(-50%);
        background:radial-gradient(circle,rgba(125,211,252,.26) 0%,rgba(125,211,252,0) 62%);filter:blur(14px)}
  .stack{position:absolute;left:96px;right:96px;top:250px;display:flex;flex-direction:column;gap:48px}
  .line{color:#F7F6F3;font-weight:800;letter-spacing:-.02em;line-height:1.04;opacity:0}
  .l1{font-size:132px}
  .l2{font-size:64px;color:#7DD3FC}
  .l3{font-size:46px;font-weight:600;color:#C8D6EA;letter-spacing:.01em}
  .l4{font-size:74px}
  .cta{position:absolute;left:96px;bottom:150px;padding:36px 64px;border-radius:999px;background:#F7F6F3;color:#0F172A;
       font-size:46px;font-weight:900;letter-spacing:.02em;opacity:0}
  .mark{position:absolute;left:96px;top:180px;font-size:32px;font-weight:800;letter-spacing:.32em;color:#7DD3FC;opacity:0}
</style></head><body>
<div id="root" data-composition-id="nobogent_offer_reel" data-width="1080" data-height="1920" data-duration="${DURATION}">
  <audio id="bed" src="bed.m4a" data-start="0" data-duration="15" data-track-index="0" data-volume="1"></audio>
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
  tl.to('#mark',  { opacity: 1, duration: 0.6 }, 0.3)
    .to('#l1',    { opacity: 1, y: -8, duration: 0.7 }, 0.9)
    .to('#l2',    { opacity: 1, duration: 0.6 }, 3.2)
    .to('#l3',    { opacity: 1, duration: 0.6 }, 6.2)
    .to('#l4',    { opacity: 1, duration: 0.5 }, 9.2)
    .to('#cta',   { opacity: 1, scale: 1.02, duration: 0.5 }, 11.6)
    .to({}, { duration: ${DURATION} });
  window.__timelines = window.__timelines || {};
  // The timeline id MUST match the root's data-composition-id; lint reports timeline_id_mismatch otherwise and
  // the runtime cannot auto-nest the timeline, which is how a composition renders its first frame and then stops.
  window.__timelines['nobogent_offer_reel'] = tl;
</script>
</body></html>`;

const script = [
  'set -uo pipefail',
  'cd nobogent_reel',
  'rm -f bed.m4a out.mp4 out_raw.mp4',
  'echo "=== 1. music bed FIRST — the composition references it ==="',
  `ffmpeg -hide_banner -v error -f lavfi -i "aevalsrc='0.10*sin(2*PI*220*t)+0.075*sin(2*PI*277.18*t)+0.065*sin(2*PI*329.63*t)':s=48000:d=${DURATION}" -af "tremolo=f=0.12:d=0.35,lowpass=f=2200,volume=0.9,afade=t=in:st=0:d=1.2,afade=t=out:st=${DURATION - 1}:d=1.0,loudnorm=I=-16:TP=-1.5:LRA=11" -c:a aac -b:a 160k -y bed.m4a 2>&1 | tail -3`,
  'ls -la bed.m4a 2>/dev/null || echo "NO BED"',
  'echo "=== 2. lint (0 errors required) ==="',
  'npx --yes hyperframes lint 2>&1 | tail -6',
  'echo "=== 3. render: the renderer mixes the bed, so the MP4 carries its own audio ==="',
  'npx --yes hyperframes render --quality draft -o out_raw.mp4 2>&1 | tail -6',
  'cp out_raw.mp4 out.mp4 2>/dev/null || true',
  'echo "=== 4. measure the delivered file ==="',
  'ffprobe -v error -show_entries stream=codec_type,codec_name -of csv=p=0 out.mp4',
  'echo "DUR:$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 out.mp4)"',
  'ffmpeg -hide_banner -i out.mp4 -af volumedetect -f null - 2>&1 | grep -E "mean_volume|max_volume" || true',
  'echo "SIZE:$(stat -c%s out.mp4)"',].join('\n');

const res = await executeInE2BSandbox({
  files: [{ path: 'nobogent_reel/index.html', content: HTML }],
  command: script,
  readFiles: ['nobogent_reel/out.mp4'],
  userId: ADMIN,
  timeoutMs: 280_000,
});

console.log(res.stdout);
if (res.stderr) console.log('STDERR:', String(res.stderr).slice(-600));
const url = res.uploadedFiles?.['nobogent_reel/out.mp4'];
console.log('\nfinal film:', url ?? '(not uploaded)');
if (url) fs.writeFileSync('.tmp-reel-final-url.txt', url);
