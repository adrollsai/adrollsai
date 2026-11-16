/**
 * A video ad and three creative ads for Procolor Film Academy's "Diploma in Cinematography",
 * produced through the agent's own tools.
 *
 * The agent writes the creative direction first (headlines, palette, three distinct angles, and a
 * scene-by-scene video script), then the real tools run: three image generations and one HyperFrames
 * composition rendered to MP4 using the academy's own photograph.
 *
 * Every gated spend is approved explicitly, one card per action, exactly as the UI would.
 */
import fs from 'node:fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { generateText } from 'ai';
import { createAgentContext } from '../lib/agent/orchestrator';
import { getAgentModel } from '../lib/agent/deepseek';

dotenv.config({ path: '.env.local', quiet: true });
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const OWNER = '9c0748de-e3da-4ea1-b323-4ce736b5ca7c';
const PRODUCT_ID = 'cd40f892-81bc-4712-a40d-ac3163588628';
const OUT = 'C:\\Users\\Adrolls\\Desktop\\nobo-e2e\\procolor';
fs.mkdirSync(OUT, { recursive: true });

/** Approve one staged action the way the UI does. */
async function approve(actionId: string) {
  const { error } = await admin
    .from('agent_events')
    .update({ status: 'approved', updated_at: new Date().toISOString() })
    .eq('user_id', OWNER)
    .eq('event_type', 'PENDING_ACTION_APPROVAL')
    .eq('payload->>actionId', actionId);
  return !error;
}

const ctx = await createAgentContext(admin, OWNER, {
  intentText: 'make a video ad and three creative ads for the Diploma in Cinematography',
});
const tools = ctx.tools as any;

// ── 1. the agent's creative direction ────────────────────────────────────────
console.log('▸ asking the agent for the creative direction…');
const brief = await generateText({
  model: await getAgentModel(),
  system: ctx.systemPrompt,
  prompt:
    'You are writing a paid-ads campaign for Procolor Film Academy (Sector 35-C, Chandigarh) for the ' +
    'product "Diploma in Cinematography" — an 8-week hands-on course: camera operation, exposure, ' +
    'lenses, shot design, lighting, camera movement, visual storytelling; shoots on cinema and ' +
    'mirrorless cameras, gimbals, pro LED lights; you leave with a short film, a documentary, a ' +
    'diploma certificate and a showreel-ready portfolio, plus placement assistance. PFA has a ' +
    '50-year imaging legacy, 10+ years teaching, 500+ alumni, 1000+ projects. Phone 9569919985.\n\n' +
    'Reply with ONLY valid JSON, no prose:\n' +
    '{"headline":"...","subhead":"...","cta":"...","palette":["#hex","#hex"],"images":[' +
    '{"angle":"...","prompt":"a complete, highly descriptive image-generation prompt, photography-grade, ' +
    'no text in image"},... three distinct angles ...],"video":{"scenes":[{"text":"on-screen word or ' +
    'phrase","seconds":2},...],"endCard":{"headline":"...","line":"...","phone":"9569919985"}}}\n' +
    'The video must be 12-20 seconds total, vertical 9:16, cinematic, type-led. No prices, no invented ' +
    'claims, no testimonials.',
  tools: {},
});

let spec: any = {};
try {
  spec = JSON.parse(String(brief.text).replace(/^```json\s*|```$/g, '').trim());
} catch {
  console.error('could not parse the brief, falling back to a sane default');
  spec = {};
}
const headline = spec.headline || 'Learn to light. Learn to shoot.';
const subhead = spec.subhead || 'Diploma in Cinematography · 8 weeks · Chandigarh';
const palette: string[] = Array.isArray(spec.palette) && spec.palette.length ? spec.palette : ['#0B0B0F', '#D0E8FF'];
console.log(`  headline: ${headline}\n  subhead : ${subhead}\n  palette : ${palette.join(' ')}`);

const productImage =
  'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/properties/9c0748de-e3da-4ea1-b323-4ce736b5ca7c/1794496762744-PFADiplomainCinematography.jpg';

// ── 2. three creatives ──────────────────────────────────────────────────────
const angles: { angle: string; prompt: string }[] = Array.isArray(spec.images) && spec.images.length
  ? spec.images.slice(0, 3)
  : [
      { angle: 'craft', prompt: 'Cinematic behind-the-scenes photograph of a film student operating a professional cinema camera on a shoulder rig, warm practical lights and haze, night interior, shallow depth of field, editorial photography, no text.' },
      { angle: 'light', prompt: 'Cinematographer adjusting a large softbox LED light on a film set, strong rim light and soft shadows, moody teal and amber grade, editorial photography, no text.' },
      { angle: 'career', prompt: 'A film crew silhouetted on a rooftop at golden hour, gimbal and monitor in frame, city skyline behind, cinematic wide shot, aspirational, editorial photography, no text.' },
    ];

const results: { kind: string; angle?: string; url: string }[] = [];
for (const [i, a] of angles.entries()) {
  const prompt =
    `A premium 1:1 square paid-ads photograph for a cinematography school. ${a.prompt} ` +
    `Shot on a full-frame camera, photorealistic, cinematic colour grade, no text, no logos, no watermark, ` +
    `clean composition with room for a headline overlay.`;

  console.log(`\n▸ creative ${i + 1}/3 (${a.angle})…`);
  const blocked = await tools.generate_ai_image.execute({ prompt, aspectRatio: '1:1' });
  const actionId = blocked?.actionId as string | undefined;
  if (!actionId) {
    console.log('  no approval card:', JSON.stringify(blocked).slice(0, 160));
    continue;
  }
  if (!(await approve(actionId))) console.log('  could not approve');

  const out = await tools.generate_ai_image.execute({ approvalId: actionId });
  const url = out?.imageUrl || out?.url || out?.assetUrl || '';
  console.log(`  ${out?.success ? 'ok' : 'failed'}: ${url || JSON.stringify(out).slice(0, 140)}`);
  if (url) {
    results.push({ kind: 'image', angle: a.angle, url });
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    fs.writeFileSync(`${OUT}\\creative-${i + 1}-${String(a.angle).replace(/\W+/g, '-')}.png`, buf);
  }
}

// ── 3. the video ad ─────────────────────────────────────────────────────────
const scenes: { text: string; seconds: number }[] = Array.isArray(spec.video?.scenes) && spec.video.scenes.length
  ? spec.video.scenes
  : [
      { text: 'LEARN TO LIGHT', seconds: 3 },
      { text: 'LEARN TO SHOOT', seconds: 3 },
      { text: '8 WEEKS. REAL FILMS.', seconds: 3 },
    ];
const total = Math.min(20, scenes.reduce((n, s) => n + (Number(s.seconds) || 3), 0) + 4);
const endCard = spec.video?.endCard || { headline: 'DIPLOMA IN CINEMATOGRAPHY', line: 'Procolor Film Academy · Chandigarh', phone: '9569919985' };

// Build a GSAP timeline whose scene starts are computed, so the film matches the script.
let t = 0;
const sceneJs = scenes
  .map((s, i) => {
    const dur = Number(s.seconds) || 3;
    const line = `tl.fromTo('#s${i}', {opacity:0, y:40}, {opacity:1, y:0, duration:0.7, ease:'power3.out'}, ${t});` +
      `tl.to('#s${i}', {opacity:0, y:-30, duration:0.5, ease:'power2.in'}, ${t + dur - 0.5});`;
    t += dur;
    return line;
  })
  .join('\n      ');
const endAt = t;
const html = `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  html,body{margin:0;background:${palette[0]};font-family:'Helvetica Neue',Arial,sans-serif}
  #stage{position:relative;width:1080px;height:1920px;overflow:hidden;background:radial-gradient(120% 90% at 50% 20%, #17171f 0%, ${palette[0]} 60%)}
  .photo{position:absolute;inset:0;background-image:url('${productImage}');background-size:cover;background-position:center;opacity:.28;filter:saturate(.85) contrast(1.05)}
  .veil{position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,.55) 0%, rgba(0,0,0,.15) 40%, rgba(0,0,0,.75) 100%)}
  .line{position:absolute;left:90px;right:90px;top:820px;color:#fff;font-weight:800;font-size:96px;line-height:1.02;letter-spacing:-2px;text-align:left;opacity:0}
  .rule{position:absolute;left:90px;top:1120px;height:4px;width:0;background:${palette[1]}}
  .brand{position:absolute;left:90px;top:1180px;color:${palette[1]};font-size:34px;letter-spacing:6px;font-weight:700}
  .end{position:absolute;left:90px;right:90px;top:700px;opacity:0;text-align:left}
  .end h2{color:#fff;font-size:86px;margin:0 0 26px;font-weight:800;letter-spacing:-1px;line-height:1.05}
  .end p{color:${palette[1]};font-size:38px;margin:0 0 14px;font-weight:600}
  .end .tel{color:#fff;font-size:52px;font-weight:800;margin-top:26px}
</style></head>
<body>
<div id="stage" data-dur="${total}" data-fps="30">
  <div class="photo"></div><div class="veil"></div>
  ${scenes.map((s, i) => `<div class="line" id="s${i}">${String(s.text).toUpperCase()}</div>`).join('\n  ')}
  <div class="rule" id="rule"></div>
  <div class="brand" id="brand">PROCOLOR FILM ACADEMY</div>
  <div class="end" id="end">
    <h2>${String(endCard.headline).toUpperCase()}</h2>
    <p>${endCard.line}</p>
    <div class="tel">${endCard.phone}</div>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script>
  const tl = gsap.timeline();
      ${sceneJs}
  tl.to('#rule', {width:'300px', duration:0.8, ease:'power2.inOut'}, ${Math.max(0, endAt - 1.6)});
  tl.to('#brand', {opacity:1, duration:0.6}, ${Math.max(0, endAt - 1.2)});
  tl.to(['#rule','#brand'], {opacity:0, duration:0.4}, ${endAt});
  tl.fromTo('#end', {opacity:0, y:30}, {opacity:1, y:0, duration:0.8, ease:'power3.out'}, ${endAt + 0.2});
  tl.to('#end', {duration: 2.4});
</script></body></html>`;

fs.writeFileSync(`${OUT}\\video-composition.html`, html, 'utf8');
console.log(`\n▸ rendering the ${total}s video ad…`);
const blockedVideo = await tools.sandbox_render_hyperframes.execute({
  projectName: 'procolor_cinematography_ad',
  title: 'Procolor — Diploma in Cinematography',
  htmlContent: html,
  durationSeconds: total,
  resolution: '1080x1920_vertical',
  quality: 'looks',
});
const videoAction = blockedVideo?.actionId as string | undefined;
if (blockedVideo?.videoUrl) {
  console.log('  rendered directly:', blockedVideo.videoUrl);
  results.push({ kind: 'video', url: blockedVideo.videoUrl });
} else if (videoAction) {
  await approve(videoAction);
  const rendered = await tools.sandbox_render_hyperframes.execute({ approvalId: videoAction });
  const url = rendered?.videoUrl || '';
  console.log(' ', rendered?.success ? `ok: ${url}` : JSON.stringify(rendered).slice(0, 300));
  if (url) results.push({ kind: 'video', url });
} else {
  console.log('  render result:', JSON.stringify(blockedVideo).slice(0, 400));
}

fs.writeFileSync(`${OUT}\\results.json`, JSON.stringify({ headline, subhead, palette, results }, null, 2));
console.log('\n=== delivered ===');
for (const r of results) console.log(`${r.kind}${r.angle ? ` (${r.angle})` : ''}: ${r.url}`);
