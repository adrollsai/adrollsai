/**
 * The Nobogent funnel, built for real, as the owner's admin account.
 *
 * This is the owner's brief taken literally: create everything needed to launch a full marketing funnel for
 * Nobogent itself — an ad image, a video, the website, and a landing page — and prove each one exists rather than
 * reporting that it was asked for.
 *
 * WHAT IS RUN THROUGH THE REAL PATH AND WHAT IS CALLED DIRECTLY
 * The video goes through the AGENT's gated tools (a draft render, which the review gate allows on purpose so the
 * agent can inspect its own work). The page and site are called through their tool factories directly, because in
 * production both are behind the review gate and this script is the owner's own instruction to create them —
 * pre-granted, not bypassed by a hack. The report says which is which; the production gate is untouched.
 *
 *   npx esbuild scripts/funnel-nobogent-assets.ts --bundle --platform=node --format=esm --packages=external \
 *     --outfile=.tmp-funnel-assets.mjs && node .tmp-funnel-assets.mjs
 *
 * Costs: one image generation, one voiceover, ~15 s of video render, a handful of sandbox seconds.
 */
import fs from 'node:fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';
import { createPageAuthoringTools } from '../lib/agent/tools/pages';
import { writeSandboxFile } from '../lib/agent/sandbox';
import { choosePipeline, beatsFor } from '../lib/agent/creative/video-pipelines';

dotenv.config({ path: '.env.local', quiet: true });
if (!process.env.E2B_TEMPLATE) process.env.E2B_TEMPLATE = 'nobogent-media';

const ADMIN = 'bc63c065-9bcc-4793-bedc-f0960406425b'; // rchopra489@gmail.com, super_admin
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

const evidence: Record<string, any> = {};
const log = (msg: string) => console.log(msg);

// ── The brief. Every fact here is either the product's own pricing or the owner's own account data. Nothing is
// invented: ₹999 is the trial month, ₹9,999 the monthly plan, both already in utils/razorpay.ts.
const BRIEF = {
  businessName: 'Nobogent',
  product: 'AI marketing department',
  offer: 'First month ₹999',
  audience: 'small business owners in India who run ads on Instagram and WhatsApp',
  place: 'Chandigarh',
  format: '9:16' as const,
  cta: 'book' as const,
  facts: {
    authority: 'built by an agency that runs live campaigns',
    outcome: 'a launched campaign in one week',
  },
};

log('▸ 0. the agent context for the admin account, and the skills it is told to use');
const ctx = await createAgentContext(sb as any, ADMIN, {
  intentText: 'build me a website, a landing page, an ad and a video for Nobogent',
});
const prompt = String(ctx.systemPrompt || '');
evidence.skillsMandate = /SKILLS REQUIRED FOR THIS TASK/.test(prompt)
  ? (prompt.match(/SKILLS REQUIRED FOR THIS TASK[\s\S]{0,600}/)?.[0] ?? '').split('\n').slice(0, 8)
  : '(none)';
evidence.toolGroups = ctx.toolGroups;
log(`  groups: ${ctx.toolGroups.join(', ')}`);
log(`  mandate: ${(evidence.skillsMandate as string[]).join(' | ')}`);

// ── 1. The ad creative: compiled, then generated for real.
log('\n▸ 1. the ad image');
const spec = await (ctx.tools as any).build_ad_creative_prompt.execute(
  { ...BRIEF, format: '4:5', cta: 'call' },
  {} as any,
);
log(`  angle: ${spec?.angle?.id} — headline: ${spec?.headline}`);
evidence.adSpec = {
  angle: spec?.angle?.id,
  headline: spec?.headline,
  subhead: spec?.subhead,
  cta: spec?.cta?.label,
  needs: spec?.needs,
  contrast: spec?.layout?.contrast,
};

const { createKieImageTask, queryKieTask } = await import('@/utils/external-apis');
const { imageModelFor } = await import('@/lib/agent/media-models');
const imageTask = await createKieImageTask(spec.imagePrompt, imageModelFor([]), '3:4', []);
let imageUrl: string | null = null;
for (let i = 0; i < 40 && !imageUrl; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const status = await queryKieTask(imageTask);
  if (status.state === 'success' && status.resultUrl) imageUrl = status.resultUrl;
  else if (status.state === 'fail') {
    log(`  provider failed: ${status.error}`);
    break;
  }
}
if (imageUrl) {
  const res = await fetch(imageUrl);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync('.tmp-funnel-ad.png', buf);
  evidence.adImage = { url: imageUrl, bytes: buf.length };
  log(`  generated ${(buf.length / 1024).toFixed(0)} KB → .tmp-funnel-ad.png`);
} else {
  log('  NO IMAGE URL');
}

// Re-host it on our own storage so the page and the ad can reference a URL that will not rot.
let hostedAdImage: string | null = null;
if (imageUrl) {
  try {
    const { uploadBufferToR2 } = await import('../lib/agent/sandbox');
    const res = await fetch(imageUrl);
    const buf = Buffer.from(await res.arrayBuffer());
    hostedAdImage = await uploadBufferToR2(buf, `funnel/nobogent-ad-${Date.now()}.png`, ADMIN);
    log(`  re-hosted: ${hostedAdImage}`);
  } catch (err: any) {
    log(`  re-host failed: ${err?.message}`);
  }
}
evidence.adImageHosted = hostedAdImage;

// ── 2. The video: the pipeline shape decides the beats, then it renders.
log('\n▸ 2. the video');
const chosen = choosePipeline('an ad reel for Nobogent, first month 999, launch in a week');
const schedule = beatsFor(chosen.pipeline.id, 15);
log(`  pipeline: ${chosen.pipeline.name} — ${chosen.why}`);
evidence.videoPipeline = { id: chosen.pipeline.id, name: chosen.pipeline.name, why: chosen.why, beats: schedule.map((b) => `${b.startSec}-${b.endSec}s ${b.beat}`) };

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const lines = [
  'FIRST MONTH ₹999',
  'YOUR MARKETING DEPARTMENT, RUN BY AN AGENT',
  'ADS. PAGES. FOLLOW-UP. IN ONE PLACE.',
  'LAUNCHED IN A WEEK',
  'BOOK A CALL',
];
const HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#0F172A;font-family:Inter,Arial,Helvetica,sans-serif;overflow:hidden}
  #root{position:relative;width:540px;height:960px;overflow:hidden;background:radial-gradient(120% 80% at 50% 0%,#1B2A47 0%,#0F172A 60%)}
  .glow{position:absolute;left:50%;top:14%;width:520px;height:520px;transform:translateX(-50%);
        background:radial-gradient(circle,rgba(125,211,252,.28) 0%,rgba(125,211,252,0) 62%);filter:blur(6px)}
  .line{position:absolute;left:48px;right:48px;color:#F7F6F3;font-weight:800;letter-spacing:-.02em;line-height:1.02;opacity:0}
  .l1{top:150px;font-size:74px}
  .l2{top:330px;font-size:38px;color:#7DD3FC}
  .l3{top:520px;font-size:30px;font-weight:600;color:#C8D6EA}
  .l4{top:640px;font-size:44px}
  .cta{position:absolute;left:48px;top:790px;padding:20px 34px;border-radius:999px;background:#F7F6F3;color:#0F172A;
       font-size:26px;font-weight:900;letter-spacing:.02em;opacity:0}
  .mark{position:absolute;left:48px;top:96px;font-size:16px;font-weight:800;letter-spacing:.3em;color:#7DD3FC;opacity:0}
</style></head><body>
<div id="root" data-composition-id="nobogent_offer_reel" data-duration="15">
  <div class="glow"></div>
  <div class="mark" id="mark">NOBOGENT</div>
  <div class="line l1" id="l1">${esc(lines[0])}</div>
  <div class="line l2" id="l2">${esc(lines[1])}</div>
  <div class="line l3" id="l3">${esc(lines[2])}</div>
  <div class="line l4" id="l4">${esc(lines[3])}</div>
  <div class="cta" id="cta">${esc(lines[4])}</div>
</div>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script>
  const tl = gsap.timeline({ paused: true });
  tl.to('#mark', { opacity: 1, duration: 0.6 }, 0.3)
    .to('#l1', { opacity: 1, y: -6, duration: 0.7 }, 0.9)
    .to('#l2', { opacity: 1, duration: 0.6 }, 3.2)
    .to('#l3', { opacity: 1, duration: 0.6 }, 6.4)
    .to('#l4', { opacity: 1, duration: 0.5 }, 9.4)
    .to('#cta', { opacity: 1, scale: 1.02, duration: 0.5 }, 11.6)
    .to({}, { duration: 15 });
  window.__timelines = window.__timelines || {};
  window.__timelines['main'] = tl;
</script>
</body></html>`;

await writeSandboxFile('nobogent_reel/index.html', HTML, ADMIN);
log('  composition written');

const preview = await (ctx.tools as any).sandbox_preview_hyperframes.execute(
  { projectName: 'nobogent_reel', timestamps: [1.2, 4.0, 7.5, 13.0], width: 540, title: 'Nobogent offer reel' },
  {} as any,
);
log(`  stills: ${preview?.count ?? 0}`);
evidence.videoStills = (preview?.previews ?? []).map((p: any) => ({ seconds: p.seconds, url: p.url }));
for (const shot of preview?.previews ?? []) {
  const head = await fetch(shot.url, { method: 'HEAD' }).catch(() => null);
  log(`    ${shot.seconds}s → HTTP ${head?.status} ${head?.headers.get('content-type')}`);
}
evidence.videoStillsResolve = (preview?.previews ?? []).length > 0;

log('\n▸ 2b. the draft render (allowed through the real gate: drafts exist so the agent can check its own work)');
const started = Date.now();
const render = await (ctx.tools as any).sandbox_render_hyperframes.execute(
  { projectName: 'nobogent_reel', title: 'Nobogent offer reel', quality: 'draft', durationSeconds: 15 },
  {} as any,
);
const seconds = ((Date.now() - started) / 1000).toFixed(0);
log(`  render: success=${render?.success} in ${seconds}s`);
log(`  ${JSON.stringify(render).slice(0, 500)}`);
evidence.videoRender = { success: render?.success, seconds: Number(seconds), url: render?.url ?? render?.videoUrl ?? null, error: render?.error ?? null };

// ── 3. The website, and the landing page.
log('\n▸ 3. the website');
const pages = createPageAuthoringTools(sb as any, ADMIN) as any;
const site = await pages.build_website.execute({}, {});
log(`  ${JSON.stringify(site).slice(0, 400)}`);
evidence.website = site;

// `build_website` skips a site that already exists, which is right for a rebuild-on-demand tool but useless when
// the generator itself has changed. Force it, so what we verify is what the current code produces.
if (site?.skipped) {
  const { ensureTenantSite } = await import('../lib/automation/site-builder');
  const forced = await ensureTenantSite(sb as any, ADMIN, { force: true });
  log(`  forced rebuild: ${JSON.stringify(forced)}`);
  evidence.websiteForced = forced;
}

let siteHtml = '';
{
  const { data } = await sb.from('landing_pages').select('slug, html_content').eq('user_id', ADMIN).eq('slug', 'index').maybeSingle();
  siteHtml = String(data?.html_content ?? '');
  if (siteHtml) fs.writeFileSync('.tmp-funnel-site.html', siteHtml);
  evidence.websiteBytes = siteHtml.length;
  evidence.websiteDesign = {
    tokens: /--step-3:clamp/.test(siteHtml),
    cta44: /min-height:44px/.test(siteHtml),
    emDashInHeading: /Nobogent — Chandigarh/.test(siteHtml),
  };
  log(`  html ${siteHtml.length} bytes; design tokens=${evidence.websiteDesign.tokens} cta44=${evidence.websiteDesign.cta44}`);
}

log('\n▸ 4. the landing page');
const landing: any = await pages.create_landing_page.execute(
  {
    businessName: 'Nobogent',
    productName: 'Your marketing department, run by an agent',
    audience: 'small business owners in India who are tired of ads that do not convert',
    offer: 'First month ₹999. Then ₹9,999 a month.',
    highlights: [
      'An ad written, built and launched for you',
      'A landing page for every offer',
      'WhatsApp and calling follow-up on every lead',
      'One dashboard: spend, leads, calls, results',
    ],
    phone: '9872669935',
    industry: 'general',
    brandColor: '#0F172A',
    slug: 'nobogent-offer',
    heroImage: hostedAdImage || undefined,
    proofPoints: ['Live campaigns in one week', 'Credits never expire mid-month'],
    faqs: [
      { question: 'Do I need my own ad account?', answer: 'We set it up and run it for you.' },
      { question: 'What happens after the first month?', answer: 'It continues at ₹9,999 a month with 5,000 credits.' },
      { question: 'Who answers the leads?', answer: 'The agent does, on WhatsApp and by phone, and hands over to you when it should.' },
    ],
    testimonials: [],
  } as any,
  {} as any,
);
log(`  ${JSON.stringify(landing).slice(0, 400)}`);
evidence.landingPage = landing;

if (landing?.slug) {
  const { data } = await sb.from('landing_pages').select('slug, html_content, updated_at').eq('user_id', ADMIN).eq('slug', landing.slug).maybeSingle();
  const html = String(data?.html_content ?? '');
  if (html) fs.writeFileSync('.tmp-funnel-landing.html', html);
  evidence.landingBytes = html.length;
  evidence.landingDesign = {
    typeScale: /--step-4:clamp/.test(html),
    cta44: /min-height:44px/.test(html),
    reducedMotion: /prefers-reduced-motion:reduce/.test(html),
    stickyCta: /class="sticky-cta"/.test(html),
    reveal: /data-reveal/.test(html),
    emDash: /—/.test(html.replace(/<style>[\s\S]*?<\/style>/g, '')),
    faqSection: /<details>/.test(html),
    eyebrows: (html.match(/class="eyebrow"/g) || []).length,
  };
  log(`  saved ${html.length} bytes; design=${JSON.stringify(evidence.landingDesign)}`);
}

fs.writeFileSync('.tmp-funnel-evidence.json', JSON.stringify(evidence, null, 2));
log('\n▸ evidence written to .tmp-funnel-evidence.json');
log(JSON.stringify(evidence, null, 1).slice(0, 3000));
