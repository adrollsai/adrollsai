/**
 * Run the page pipeline for Nobogent: plan, author, look at it, improve it, publish only if it passes.
 *
 * Every dependency is real: the model authors with scroll-craft and ui-ux-pro-max in its prompt, headless Chrome in the
 * sandbox renders the page, Gemini vision scores the screenshot against the rubric, and artefact QA decides whether it
 * may go live.
 *
 *   npx esbuild scripts/run-page-pipeline.ts --bundle --platform=node --format=esm --packages=external \
 *     --outfile=.tmp-page-pipeline.mjs && node .tmp-page-pipeline.mjs
 */
import '../lib/env-local';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { getAgentModel } from '../lib/agent/deepseek';
import { buildPageWithReview, type PageBrief } from '../lib/agent/creative/page-pipeline';
import { analyzeImageWithGemini } from '../utils/image-analysis';
import { executeInE2BSandbox } from '../lib/agent/sandbox';

const ADMIN = 'bc63c065-9bcc-4793-bedc-f0960406425b';
const CHROME_SESSION = 'gimg-browser-probe';

const HERO =
  'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/agent_sandbox/bc63c065-9bcc-4793-bedc-f0960406425b/1794885563768_hero-hero-1794885563768.png';
const DETAIL =
  'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/agent_sandbox/bc63c065-9bcc-4793-bedc-f0960406425b/1794885630079_hero-detail-1794885630078.png';

const brief: PageBrief = {
  businessName: 'Nobogent',
  productName: 'Your marketing department, run by an agent',
  audience: 'small business owners in India who are tired of paying for ads that do not convert',
  offer: 'First month ₹999, then ₹9,999 a month',
  highlights: [
    'An ad written, built and launched for you',
    'A landing page for every offer',
    'WhatsApp and calling follow-up on every lead',
    'One dashboard: spend, leads, calls, results',
  ],
  proofPoints: ['Live campaigns in one week', '5,000 credits a month on the standard plan'],
  faqs: [
    { question: 'Do I need my own ad account?', answer: 'We set it up and run it for you.' },
    { question: 'What happens after the first month?', answer: 'It continues at ₹9,999 a month with 5,000 credits.' },
    { question: 'Who answers the leads?', answer: 'The agent does, on WhatsApp and by phone, and hands over to you when it should.' },
  ],
  heroImage: HERO,
  galleryImages: [DETAIL],
  phone: '9872669935',
  brandColor: '#0B1220',
  industry: 'general',
};

/** Render the page in the sandbox and publish the screenshot. */
async function screenshot(html: string, label: string): Promise<string | null> {
  const res = await executeInE2BSandbox({
    files: [{ path: `/tmp/pp/${label}.html`, content: html }],
    command: [
      'BIN=$(find /tmp/gimg/browsers -name chrome-headless-shell -type f 2>/dev/null | head -1)',
      '[ -z "$BIN" ] && { echo NO_BROWSER; exit 4; }',
      `"$BIN" --no-sandbox --disable-gpu --hide-scrollbars --window-size=1280,3400 --screenshot=/tmp/pp/${label}.png --virtual-time-budget=6000 file:///tmp/pp/${label}.html 2>&1 | tail -2`,
      `ls -la /tmp/pp/${label}.png`,
    ].join('\n'),
    readFiles: [`/tmp/pp/${label}.png`],
    userId: CHROME_SESSION,
    timeoutMs: 200000,
  });
  const url = (res.uploadedFiles as any)?.[`/tmp/pp/${label}.png`] ?? null;
  console.log(`  screenshot ${label}: ${url ? 'ok' : 'FAILED'}`);
  if (url) {
    const img = await fetch(url);
    fs.writeFileSync(`.tmp-pipeline-${label}.png`, Buffer.from(await img.arrayBuffer()));
  }
  return url;
}

console.log('=== PAGE PIPELINE ===');
const model = await getAgentModel({});
const result = await buildPageWithReview({ brief, model, screenshot, inspect: (url, prompt) => analyzeImageWithGemini(url, prompt) });

fs.writeFileSync('.tmp-pipeline-page.html', result.html);
console.log(`\n=== RESULT after ${result.iterations} round(s) ===`);
console.log(`bytes: ${result.html.length}`);
console.log(`QA: ${result.qa.ok ? 'PASS' : 'FAIL'}`);
for (const finding of result.qa.findings) {
  if (!finding.ok) console.log(`  FAIL ${finding.check} — ${finding.detail}`);
}
const last = result.critiques[result.critiques.length - 1];
if (last) {
  console.log(`review: ${last.ok ? 'passed' : 'not passed'}`);
  console.log(`  scores: ${Object.entries(last.scores).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  for (const fix of last.fixes.slice(0, 6)) console.log(`  outstanding fix: ${fix}`);
}
console.log(`screenshots: ${result.screenshots.join(' , ')}`);

// Publish only if both the review and the structural gate agree.
const ready = result.qa.ok && (last?.ok ?? false);
if (ready) {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
    auth: { persistSession: false },
  });
  const { error } = await sb.from('landing_pages').upsert(
    {
      user_id: ADMIN,
      slug: 'nobogent-offer',
      title: 'Your marketing department, run by an agent | Nobogent',
      product_name: brief.productName,
      html_content: result.html,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id, slug' },
  );
  console.log(error ? `publish FAILED: ${error.message}` : 'published to /nobogent-offer');
} else {
  console.log('NOT published: the page did not clear both gates, and shipping it anyway is what we are fixing.');
}
