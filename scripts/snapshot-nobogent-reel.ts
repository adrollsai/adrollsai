/**
 * Write the composition and snapshot it in ONE sandbox call.
 *
 * The previous attempt wrote the file (data-width landed) and then snapshotted what appeared to be an older copy, so
 * the layout fix was invisible in the stills. Doing both in a single call removes the question of which sandbox,
 * which working directory and which copy the snapshot read — and it prints the file's own fingerprint before the
 * snapshot runs, so the log says what was actually rendered.
 */
import fs from 'node:fs';
import dotenv from 'dotenv';
import { executeInE2BSandbox } from '../lib/agent/sandbox';

dotenv.config({ path: '.env.local', quiet: true });
if (!process.env.E2B_TEMPLATE) process.env.E2B_TEMPLATE = 'nobogent-media';

const ADMIN = 'bc63c065-9bcc-4793-bedc-f0960406425b';
const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const LINES = [
  'FIRST MONTH ₹999',
  'YOUR MARKETING DEPARTMENT, RUN BY AN AGENT',
  'ADS. PAGES. FOLLOW-UP. IN ONE PLACE.',
  'LAUNCHED IN A WEEK',
  'BOOK A CALL',
];

const HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#0F172A;font-family:Inter,Arial,Helvetica,sans-serif;overflow:hidden}
  #root{position:relative;width:1080px;height:1920px;overflow:hidden;background:radial-gradient(120% 80% at 50% 0%,#1B2A47 0%,#0F172A 60%)}
  .glow{position:absolute;left:50%;top:12%;width:1040px;height:1040px;transform:translateX(-50%);
        background:radial-gradient(circle,rgba(125,211,252,.28) 0%,rgba(125,211,252,0) 62%);filter:blur(12px)}
  /* FLOW, NOT ABSOLUTE TOPS: the first cut positioned each line with a fixed top, so when the headline wrapped the
     next line was painted straight through it. A column with a gap cannot overlap itself whatever the text does. */
  .stack{position:absolute;left:96px;right:96px;top:260px;display:flex;flex-direction:column;gap:52px}
  .line{color:#F7F6F3;font-weight:800;letter-spacing:-.02em;line-height:1.04;opacity:0}
  .l1{font-size:132px}
  .l2{font-size:60px;color:#7DD3FC}
  .l3{font-size:50px;font-weight:600;color:#C8D6EA}
  .l4{font-size:72px}
  .cta{position:absolute;left:96px;bottom:150px;padding:36px 64px;border-radius:999px;background:#F7F6F3;color:#0F172A;
       font-size:46px;font-weight:900;letter-spacing:.02em;opacity:0}
  .mark{position:absolute;left:96px;top:180px;font-size:32px;font-weight:800;letter-spacing:.32em;color:#7DD3FC;opacity:0}
</style></head><body>
<div id="root" data-composition-id="nobogent_offer_reel" data-width="1080" data-height="1920" data-duration="15">
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
    .to('#l3', { opacity: 1, duration: 0.6 }, 6.4)
    .to('#l4', { opacity: 1, duration: 0.5 }, 9.4)
    .to('#cta', { opacity: 1, scale: 1.02, duration: 0.5 }, 11.6)
    .to({}, { duration: 15 });
  window.__timelines = window.__timelines || {};
  window.__timelines['main'] = tl;
</script>
</body></html>`;

const SHOTS = [1.6, 4.5, 8.0, 12.6];
const script = [
  'set -uo pipefail',
  'rm -rf .hyperframes previews_raw previews && mkdir -p previews',
  'echo "--- file on disk:"',
  'wc -c nobogent_reel/index.html',
  'grep -c \'class="stack"\' nobogent_reel/index.html',
  `npx --yes hyperframes snapshot nobogent_reel --at ${SHOTS.join(',')} -o previews_raw --timeout 90000 2>&1 | tail -4`,
  'i=0',
  'for f in $(ls previews_raw/*.png 2>/dev/null | sort); do',
  '  ffmpeg -y -v error -i "$f" -vf "scale=540:-1:flags=lanczos" "previews/p$i.png" 2>/dev/null || cp "$f" "previews/p$i.png"',
  '  i=$((i+1))',
  'done',
  'echo "--- produced: $i"',
  'ls previews',
].join('\n');

const res = await executeInE2BSandbox({
  files: [{ path: 'nobogent_reel/index.html', content: HTML }],
  command: script,
  readFiles: SHOTS.map((_, i) => `previews/p${i}.png`),
  userId: ADMIN,
  timeoutMs: 280_000,
});

console.log(res.stdout);
if (res.stderr) console.log('STDERR:', String(res.stderr).slice(-400));
const uploaded = res.uploadedFiles ?? {};
console.log('\nurls:');
for (const key of Object.keys(uploaded)) console.log(`  ${key} → ${uploaded[key]}`);
fs.writeFileSync('.tmp-reel-urls.json', JSON.stringify(uploaded, null, 2));
