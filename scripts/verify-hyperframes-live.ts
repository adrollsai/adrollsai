/**
 * Does `sandbox_render_hyperframes` actually produce a video?
 *
 * Before telling the agent to route every reel through it, the renderer has to be proven. This
 * builds a small but genuinely animated HyperFrames composition (GSAP timeline, three scenes,
 * data-dur) and calls the real tool through the real orchestrator, then reports what came back.
 *
 * Cost: one E2B sandbox for the render, no generation models, no credits.
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

const OWNER = 'bc63c065-9bcc-4793-bedc-f0960406425b';

const COMPOSITION = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body { margin:0; padding:0; background:#0F172A; font-family: Inter, Arial, sans-serif; }
  #stage { position:relative; width:1080px; height:1920px; overflow:hidden; }
  .word { position:absolute; left:0; right:0; text-align:center; color:#fff; font-weight:800;
          font-size:104px; letter-spacing:-2px; opacity:0; }
  .rule { position:absolute; left:14%; height:4px; background:#D4AF37; width:0; }
  .lockup { position:absolute; left:0; right:0; text-align:center; color:#D4AF37; font-size:44px;
            letter-spacing:8px; opacity:0; }
  .phone { position:absolute; left:0; right:0; text-align:center; color:#94A3B8; font-size:34px; opacity:0; }
</style>
</head>
<body>
  <div id="stage" data-dur="8" data-fps="30">
    <div class="word" id="w1" style="top:760px">START</div>
    <div class="word" id="w2" style="top:880px">YOUR DAY</div>
    <div class="word" id="w3" style="top:1000px">STRONG</div>
    <div class="rule" id="rule" style="top:1130px"></div>
    <div class="lockup" id="lock" style="top:1200px">NOBOGENT</div>
    <div class="phone" id="phone" style="top:1280px">+91 82888 35235</div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
  <script>
    const tl = gsap.timeline();
    tl.to('#w1', { opacity: 1, duration: 0.5, ease: 'power2.out' })
      .to('#w2', { opacity: 1, duration: 0.5, ease: 'power2.out' }, '-=0.2')
      .to('#w3', { opacity: 1, duration: 0.5, ease: 'power2.out' }, '-=0.2')
      .to('#rule', { width: '72%', duration: 0.8, ease: 'power2.inOut' }, '+=0.1')
      .to('#lock', { opacity: 1, duration: 0.5 }, '-=0.2')
      .to('#phone', { opacity: 1, duration: 0.5 }, '-=0.2')
      .to('#stage', { duration: 0.8 });
  </script>
</body>
</html>`;

const ctx = await createAgentContext(admin, OWNER, { intentText: 'render a short designed reel' });
const tools = ctx.tools as any;
const render = tools.sandbox_render_hyperframes;
if (!render || typeof render.execute !== 'function') {
  console.error('sandbox_render_hyperframes is NOT in the agent toolset — that alone blocks every reel');
  process.exit(1);
}
console.log('tool present in the agent toolset: yes');

const started = Date.now();
const result = await render.execute({
  projectName: 'launch_reel_test',
  title: 'Launch reel test',
  htmlContent: COMPOSITION,
  durationSeconds: 8,
  resolution: '1080x1920_vertical',
  quality: 'draft',
});

console.log(`\nfinished in ${((Date.now() - started) / 1000).toFixed(1)}s`);
const serialised = JSON.stringify(result ?? {}, null, 2);
console.log(serialised.slice(0, 2400));
fs.writeFileSync('.tmp-render-result.json', serialised);

const url = /https:\/\/[^"\\\s]+\.mp4/.exec(serialised)?.[0];
if (url) {
  console.log(`\nvideo url: ${url}`);
  const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
  console.log(`reachable: ${head ? `HTTP ${head.status}` : 'no response'}`);
  fs.writeFileSync('.tmp-render-url.txt', url);
} else {
  console.log('\nNO MP4 URL in the result — the renderer did not produce a video');
  process.exitCode = 1;
}
