/**
 * Rebuild the Procolor ad properly and fix the underlying defect.
 *
 * The first render came out static: every frame identical. Cause — HyperFrames drives GSAP by seeking
 * a PAUSED timeline that the page must register on `window.__timelines`; mine created a timeline and
 * never registered it, so there was nothing to seek. The CLI says so explicitly when duration cannot
 * be inferred ("No GSAP timeline registered (window.__timelines is empty)").
 *
 * Design fixes: one line at a time on a clean dark plate, the academy's own cinematic photograph used
 * as a photographic backdrop (not their poster, whose baked-in type fought the overlays), and a real
 * end card.
 */
import fs from 'node:fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';

dotenv.config({ path: '.env.local', quiet: true });
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const OWNER = '9c0748de-e3da-4ea1-b323-4ce736b5ca7c';
const OUT = 'C:\\Users\\Adrolls\\Desktop\\nobo-e2e\\procolor';

const BG = JSON.parse(fs.readFileSync(`${OUT}\\results.json`, 'utf8')).results.find((r: any) => r.kind === 'image')?.url
  || 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/properties/9c0748de-e3da-4ea1-b323-4ce736b5ca7c/1794496762744-PFADiplomainCinematography.jpg';

const scenes = [
  { text: 'LIGHT IS A CHOICE', at: 0, hold: 2.6 },
  { text: 'SO IS THE SHOT', at: 2.8, hold: 2.6 },
  { text: '8 WEEKS. REAL FILMS.', at: 5.6, hold: 2.8 },
  { text: 'CHANDIGARH', at: 8.6, hold: 2.4 },
];
const total = 15;

const sceneTl = scenes
  .map(
    (s, i) =>
      `tl.fromTo('#s${i}', {opacity:0, y:26}, {opacity:1, y:0, duration:0.6, ease:'power3.out'}, ${s.at});\n` +
      `tl.to('#s${i}', {opacity:0, y:-18, duration:0.45, ease:'power2.in'}, ${s.at + s.hold - 0.45});`,
  )
  .join('\n');

const html = `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  html,body{margin:0;background:#08080B;font-family:'Helvetica Neue',Arial,sans-serif}
  #stage{position:relative;width:1080px;height:1920px;overflow:hidden;background:#08080B}
  .photo{position:absolute;inset:0;background-image:url('${BG}');background-size:cover;background-position:center;filter:saturate(.9) contrast(1.05) brightness(.75)}
  .veil{position:absolute;inset:0;background:linear-gradient(180deg,rgba(4,4,6,.75) 0%,rgba(4,4,6,.35) 45%,rgba(4,4,6,.92) 100%)}
  .scene{position:absolute;left:88px;right:88px;top:800px;color:#fff;font-weight:800;font-size:92px;line-height:1.04;letter-spacing:-2px;opacity:0}
  .kicker{position:absolute;left:92px;top:700px;color:#D0E8FF;font-size:28px;letter-spacing:8px;font-weight:700;opacity:.9}
  .rule{position:absolute;left:90px;top:1000px;height:3px;width:0;background:#D0E8FF}
  .end{position:absolute;left:88px;right:88px;top:720px;opacity:0}
  .end .tag{color:#D0E8FF;font-size:26px;letter-spacing:7px;font-weight:700;margin-bottom:22px}
  .end h2{color:#fff;font-size:78px;margin:0 0 20px;font-weight:800;letter-spacing:-1.5px;line-height:1.05}
  .end .sub{color:#C7D2E0;font-size:34px;margin:0 0 8px;font-weight:500}
  .end .tel{color:#fff;font-size:54px;font-weight:800;margin-top:30px}
  .end .site{color:#8CA3BA;font-size:26px;margin-top:14px;letter-spacing:2px}
</style></head>
<body>
<div id="stage" data-duration="${total}" data-fps="30" data-composition-id="procolor_ad">
  <div class="photo"></div><div class="veil"></div>
  <div class="kicker" id="kicker">PROCOLOR FILM ACADEMY</div>
  ${scenes.map((s, i) => `<div class="scene" id="s${i}">${s.text}</div>`).join('\n  ')}
  <div class="rule" id="rule"></div>
  <div class="end" id="end">
    <div class="tag">DIPLOMA IN CINEMATOGRAPHY</div>
    <h2>Learn to light.<br/>Learn to shoot.</h2>
    <div class="sub">8 weeks · hands-on · Chandigarh</div>
    <div class="tel">9569919985</div>
    <div class="site">SECTOR 35-C, CHANDIGARH</div>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script>
  // HyperFrames renders by SEEKING a paused timeline, and it finds that timeline on
  // window.__timelines. Without this registration the film is a still image: every frame identical.
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });
      ${sceneTl}
  tl.to('#rule', { width: '320px', duration: 0.7, ease: 'power2.inOut' }, 0.35);
  tl.to('#kicker', { opacity: 0, duration: 0.4 }, 9.9);
  tl.to(['#rule'], { opacity: 0, duration: 0.3 }, 10.1);
  tl.fromTo('#end', { opacity: 0, y: 34 }, { opacity: 1, y: 0, duration: 0.7, ease: 'power3.out' }, 10.3);
  tl.to({}, { duration: 2.2 });
  window.__timelines['main'] = tl;
  window.__timelines['procolor_ad'] = tl;
</script></body></html>`;

fs.writeFileSync(`${OUT}\\video-composition-v2.html`, html, 'utf8');

const ctx = await createAgentContext(admin, OWNER, { intentText: 'render the Procolor ad' });
const tools = ctx.tools as any;

console.log(`▸ rendering a ${total}s ad with a registered timeline…`);
const started = Date.now();
const res = await tools.sandbox_render_hyperframes.execute({
  projectName: 'procolor_ad_v2',
  title: 'Procolor — Diploma in Cinematography',
  htmlContent: html,
  durationSeconds: total,
  resolution: '1080x1920_vertical',
  quality: 'looks',
});
console.log(`  ${((Date.now() - started) / 1000).toFixed(0)}s:`, JSON.stringify(res).slice(0, 400));

const url = res?.videoUrl || '';
if (url) {
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  fs.writeFileSync(`${OUT}\\video-ad-v2.mp4`, buf);
  console.log(`  saved video-ad-v2.mp4 (${(buf.length / 1024 / 1024).toFixed(1)}MB): ${url}`);
  fs.writeFileSync(`${OUT}\\video-v2.url.txt`, url);
}
