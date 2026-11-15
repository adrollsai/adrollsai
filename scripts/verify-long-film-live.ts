/**
 * Ask for a 10-minute film and see how long it actually takes.
 *
 * Before this change: 18,000 frames ≈ 25 minutes of drawing, growing linearly with length.
 * After: past the drawing cap the tool draws a stretch and repeats it, so the wall clock is
 * minutes regardless of the requested length — and the result says it repeated.
 */
import fs from 'node:fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';
import { estimateRenderSeconds, maxDrawnSeconds } from '../lib/agent/tools/hyperframes-render';

dotenv.config({ path: '.env.local', quiet: true });
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const COMPOSITION = `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
 html,body{margin:0;background:#0F172A;font-family:Arial,sans-serif}
 #stage{position:relative;width:1080px;height:1920px;overflow:hidden}
 h1{position:absolute;top:800px;left:0;right:0;text-align:center;color:#fff;font-size:92px;margin:0;opacity:0}
 p{position:absolute;top:940px;left:0;right:0;text-align:center;color:#D4AF37;font-size:40px;letter-spacing:6px;opacity:0}
</style></head>
<body><div id="stage" data-dur="600">
  <h1 id="t">LONG FILM</h1><p id="s">NOBOGENT</p>
</div>
<script>
  const tl = { start: () => {} };
  window.addEventListener('load', () => {
    const t = document.getElementById('t'), s = document.getElementById('s');
    requestAnimationFrame(() => { t.style.transition = 'opacity 1s'; t.style.opacity = '1'; });
    setTimeout(() => { s.style.transition = 'opacity 1s'; s.style.opacity = '1'; }, 900);
  });
</script>
</body></html>`;

const ctx = await createAgentContext(admin, 'bc63c065-9bcc-4793-bedc-f0960406425b', {
  intentText: '10 minute film',
});
const tools = ctx.tools as any;

console.log(`drawing cap: ${maxDrawnSeconds()}s`);
console.log(`estimate if we drew all 600s: ${estimateRenderSeconds(600)}s (~${(estimateRenderSeconds(600) / 60).toFixed(1)} min)`);
console.log(`estimate for the capped draw  : ${estimateRenderSeconds(Math.min(600, maxDrawnSeconds()))}s\n`);

const started = Date.now();
const result = await tools.sandbox_render_hyperframes.execute({
  projectName: 'long_film_test',
  title: 'Ten minute film',
  htmlContent: COMPOSITION,
  durationSeconds: 600,
  quality: 'draft',
});
const elapsed = (Date.now() - started) / 1000;

console.log(`\nwall clock: ${elapsed.toFixed(1)}s (${(elapsed / 60).toFixed(1)} min)`);
console.log(JSON.stringify(result, null, 2).slice(0, 1400));

const url = /https:\/\/[^"\\\s]+\.mp4/.exec(JSON.stringify(result))?.[0];
if (url) {
  const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
  console.log(`\nreachable: ${head ? `HTTP ${head.status}` : 'no response'}`);
  fs.writeFileSync('.tmp-long-film-url.txt', url);
}
