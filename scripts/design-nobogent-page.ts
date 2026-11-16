/**
 * Design a real Nobogent landing page with the model, grade it, and LOOK at it in a browser.
 *
 * Three things this proves, none of which any earlier page could claim:
 *   1. the page is written by the model against scroll-craft and ui-ux-pro-max, not emitted by a template;
 *   2. it passes artefact QA (real imagery, several section shapes, proof or FAQ, no em dashes);
 *   3. a headless Chrome screenshot of the RENDERED page exists, so "does it look good" is answerable instead of
 *      asserted. The screenshot is taken in the sandbox that already has chrome-headless-shell installed.
 *
 *   npx esbuild scripts/design-nobogent-page.ts --bundle --platform=node --format=esm --packages=external \
 *     --outfile=.tmp-design-page.mjs && node .tmp-design-page.mjs
 */
import fs from 'node:fs';
import 'dotenv/config';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { getAgentModel } from '../lib/agent/deepseek';
import { designLandingPage } from '../lib/agent/creative/design-page';
import { executeInE2BSandbox } from '../lib/agent/sandbox';

dotenv.config({ path: '.env.local', quiet: true });
if (!process.env.E2B_TEMPLATE) process.env.E2B_TEMPLATE = 'nobogent-media';

const ADMIN = 'bc63c065-9bcc-4793-bedc-f0960406425b';
// The sandbox that has chrome-headless-shell installed from the earlier browser probe.
const SCREENSHOT_SESSION = 'gimg-browser-probe';

const HERO = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/agent_sandbox/bc63c065-9bcc-4793-bedc-f0960406425b/1794827361451_nobogent-ad-1794827361450.png';
const SECOND = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/agent_sandbox/bc63c065-9bcc-4793-bedc-f0960406425b/1794834372413_p0.png';

const brief = {
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
  proofPoints: ['Live campaigns in one week', '5,000 credits a month on the standard plan'],
  faqs: [
    { question: 'Do I need my own ad account?', answer: 'We set it up and run it for you.' },
    { question: 'What happens after the first month?', answer: 'It continues at ₹9,999 a month with 5,000 credits.' },
    { question: 'Who answers the leads?', answer: 'The agent does, on WhatsApp and by phone, and hands over to you when it should.' },
  ],
  images: [HERO, SECOND],
  phone: '9872669935',
  brandColor: '#0F172A',
  industry: 'general',
};

console.log('▸ designing the page with the model + scroll-craft + ui-ux-pro-max');
const model = await getAgentModel({});
const design = await designLandingPage(brief, model, { maxAttempts: 2 });

console.log(`  attempts: ${design.attempts}, skills: ${design.usedSkills.join(', ')}`);
console.log(`  bytes: ${design.html.length}`);
console.log(`  QA ok: ${design.qa.ok}`);
for (const finding of design.qa.findings) {
  console.log(`    ${finding.ok ? 'ok  ' : 'FAIL'} ${finding.check} — ${finding.detail}`);
}
if (!design.html) process.exit(1);
fs.writeFileSync('.tmp-designed-page.html', design.html);

// ── Screenshot the RENDERED page. Grade structurally, then look at it.
console.log('\n▸ screenshotting it with headless Chrome');
const shot = await executeInE2BSandbox({
  files: [{ path: '/tmp/pagedesign/index.html', content: design.html }],
  command: [
    'set -uo pipefail',
    'BIN=$(find /tmp/gimg/browsers -name chrome-headless-shell -type f 2>/dev/null | head -1)',
    'if [ -z "$BIN" ]; then echo "NO_BROWSER"; exit 4; fi',
    '"$BIN" --no-sandbox --disable-gpu --hide-scrollbars --window-size=1280,2400 --screenshot=/tmp/pagedesign/desktop.png --virtual-time-budget=4000 file:///tmp/pagedesign/index.html 2>&1 | tail -3',
    '"$BIN" --no-sandbox --disable-gpu --hide-scrollbars --window-size=430,1800 --screenshot=/tmp/pagedesign/mobile.png --virtual-time-budget=4000 file:///tmp/pagedesign/index.html 2>&1 | tail -3',
    'ls -la /tmp/pagedesign/*.png',
  ].join('\n'),
  readFiles: ['/tmp/pagedesign/desktop.png', '/tmp/pagedesign/mobile.png'],
  userId: SCREENSHOT_SESSION,
  timeoutMs: 200000,
});
console.log(shot.stdout);
if (shot.stderr) console.log('STDERR:', String(shot.stderr).slice(-300));
for (const [key, url] of Object.entries(shot.uploadedFiles ?? {})) console.log(`${key} → ${url}`);

// Download the desktop shot so it can be looked at.
const desktop = (shot.uploadedFiles as any)?.['/tmp/pagedesign/desktop.png'];
if (desktop) {
  const res = await fetch(desktop);
  fs.writeFileSync('.tmp-designed-page.png', Buffer.from(await res.arrayBuffer()));
  console.log('\ndesktop screenshot saved to .tmp-designed-page.png');
}
