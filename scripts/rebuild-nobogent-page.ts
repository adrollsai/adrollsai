/**
 * Rebuild the Nobogent landing page with real imagery, grade it, and LOOK at the rendered result.
 *
 * The page failed QA on `real_imagery` (one photograph) and "designed rather than a single-column template". The cause
 * was not the builder's ability — it emits a gallery — but the brief carrying a single image. create_landing_page now
 * fills the gallery from the business's own asset library, so this checks the whole path:
 *
 *   build with the real images → grade with artefact QA → screenshot the rendered page in headless Chrome → look at it.
 *
 *   npx esbuild scripts/rebuild-nobogent-page.ts --bundle --platform=node --format=esm --packages=external \
 *     --outfile=.tmp-rebuild-page.mjs && node .tmp-rebuild-page.mjs
 */
import fs from 'node:fs';
import 'dotenv/config';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createPageAuthoringTools } from '../lib/agent/tools/pages';
import { gradePageHtml } from '../lib/automation/artefact-qa';
import { executeInE2BSandbox } from '../lib/agent/sandbox';

dotenv.config({ path: '.env.local', quiet: true });
if (!process.env.E2B_TEMPLATE) process.env.E2B_TEMPLATE = 'nobogent-media';

const ADMIN = 'bc63c065-9bcc-4793-bedc-f0960406425b';
const SCREENSHOT_SESSION = 'gimg-browser-probe'; // has chrome-headless-shell installed

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

const pages = createPageAuthoringTools(sb as any, ADMIN) as any;

console.log('▸ building the page (gallery filled from the business assets)');
const built = await pages.create_landing_page.execute(
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
    // OWNED, RELEVANT IMAGERY, supplied explicitly. Leaving the gallery to guess from the asset library made the
    // vision check reject everything (festive posters, other businesses) and the page then correctly refused to
    // publish with a single image. These two are our own Nobogent creatives, so they are supplied, not inferred.
    heroImage: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/agent_sandbox/bc63c065-9bcc-4793-bedc-f0960406425b/1794827361451_nobogent-ad-1794827361450.png',
    galleryImages: ['https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/agent_sandbox/bc63c065-9bcc-4793-bedc-f0960406425b/1794827361451_nobogent-ad-1794827361450.png'],
    proofPoints: ['Live campaigns in one week', '5,000 credits a month on the standard plan'],
    faqs: [
      { question: 'Do I need my own ad account?', answer: 'We set it up and run it for you.' },
      { question: 'What happens after the first month?', answer: 'It continues at ₹9,999 a month with 5,000 credits.' },
      { question: 'Who answers the leads?', answer: 'The agent does, on WhatsApp and by phone, and hands over to you when it should.' },
    ],
  },
  {},
);
console.log(`  success=${built?.success} slug=${built?.slug ?? ''} sections=${(built?.sections ?? []).join(',')}`);
if (!built?.success) {
  console.log('  REFUSED:', String(built?.error ?? '').slice(0, 500));
  console.log('  qa:', JSON.stringify(built?.qa ?? []).slice(0, 800));
  process.exit(1);
}

const { data: row } = await sb
  .from('landing_pages')
  .select('html_content')
  .eq('user_id', ADMIN)
  .eq('slug', built.slug)
  .maybeSingle();
const html = String(row?.html_content ?? '');
fs.writeFileSync('.tmp-funnel-landing.html', html);

const qa = gradePageHtml(html);
console.log(`\n  QA ok: ${qa.ok}`);
for (const finding of qa.findings) console.log(`    ${finding.ok ? 'ok  ' : 'FAIL'} ${finding.check} — ${finding.detail}`);

console.log('\n▸ screenshotting the rendered page');
const shot = await executeInE2BSandbox({
  files: [{ path: '/tmp/pagedesign/index.html', content: html }],
  command: [
    'set -uo pipefail',
    'BIN=$(find /tmp/gimg/browsers -name chrome-headless-shell -type f 2>/dev/null | head -1)',
    'if [ -z "$BIN" ]; then echo NO_BROWSER; exit 4; fi',
    '"$BIN" --no-sandbox --disable-gpu --hide-scrollbars --window-size=1280,3000 --screenshot=/tmp/pagedesign/desktop.png --virtual-time-budget=5000 file:///tmp/pagedesign/index.html 2>&1 | tail -2',
    'ls -la /tmp/pagedesign/desktop.png',
  ].join('\n'),
  readFiles: ['/tmp/pagedesign/desktop.png'],
  userId: SCREENSHOT_SESSION,
  timeoutMs: 200000,
});
console.log(shot.stdout);
const desktop = (shot.uploadedFiles as any)?.['/tmp/pagedesign/desktop.png'];
if (desktop) {
  const res = await fetch(desktop);
  fs.writeFileSync('.tmp-page-desktop.png', Buffer.from(await res.arrayBuffer()));
  console.log('screenshot:', desktop);
}
