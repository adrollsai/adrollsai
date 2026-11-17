/**
 * A landing page written BY THE MODEL, with scroll-craft and ui-ux-pro-max genuinely in its prompt.
 *
 * This answers the question the owner kept asking. Until now pages were emitted by a template function, so the skills
 * had no channel to influence anything — a skill is instructions for a model, and no model was involved.
 *
 * Two hard constraints learned the hard way:
 *   - the model returns AT MOST ~2600 output tokens per response, whatever maxOutputTokens asks for, so the page is
 *     requested in five small pieces rather than one;
 *   - it is told not to use em dashes and will use them anyway, so visible copy is cleaned on the way out.
 *
 *   npx esbuild scripts/model-page.ts --bundle --platform=node --format=esm --packages=external \
 *     --outfile=.tmp-model-page.mjs && node .tmp-model-page.mjs
 */
import '../lib/env-local';
import fs from 'node:fs';
import { generateText } from 'ai';
import { getAgentModel } from '../lib/agent/deepseek';
import { vendoredSkill } from '../lib/agent/skills-vendor';
import { gradePageHtml } from '../lib/automation/artefact-qa';
import { executeInE2BSandbox } from '../lib/agent/sandbox';

const HERO_IMG =
  'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/agent_sandbox/bc63c065-9bcc-4793-bedc-f0960406425b/1794885563768_hero-hero-1794885563768.png';
const DETAIL_IMG =
  'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/agent_sandbox/bc63c065-9bcc-4793-bedc-f0960406425b/1794885630079_hero-detail-1794885630078.png';

const F = {
  business: 'Nobogent',
  product: 'Your marketing department, run by an agent',
  audience: 'small business owners in India who are tired of ads that do not convert',
  offer: 'First month ₹999',
  then: 'then ₹9,999 a month',
  highlights: [
    'An ad written, built and launched for you',
    'A landing page for every offer',
    'WhatsApp and calling follow-up on every lead',
    'One dashboard: spend, leads, calls, results',
  ],
  proof: ['Live campaigns in one week', '5,000 credits a month on the standard plan'],
  faqs: [
    ['Do I need my own ad account?', 'We set it up and run it for you.'],
    ['What happens after the first month?', 'It continues at ₹9,999 a month with 5,000 credits.'],
    ['Who answers the leads?', 'The agent does, on WhatsApp and by phone, and hands over to you when it should.'],
  ],
  phone: '9872669935',
};

const scrollCraft = vendoredSkill('scroll-craft')?.content ?? '';
const uiUx = vendoredSkill('ui-ux-pro-max')?.content ?? '';
console.log(`skills in the prompt: scroll-craft ${scrollCraft.length} chars, ui-ux-pro-max ${uiUx.length} chars`);

const system = [
  'You are a senior product designer and direct-response copywriter. You write production HTML and CSS.',
  '',
  'FOLLOW THESE TWO SKILLS. They are the house standard, not suggestions:',
  '===== scroll-craft =====',
  scrollCraft.slice(0, 8000),
  '',
  '===== ui-ux-pro-max =====',
  uiUx.slice(0, 6000),
  '',
  'HOUSE RULES:',
  '- Palette: background #0B1220, panels #101B2E, text #F7F6F3, muted #A9B6C9, accent #7DD3FC.',
  '- Type scale with clamp(); body 17-18px; headings tight letter-spacing; ONE accent colour.',
  '- 44px minimum touch targets, visible focus rings, a prefers-reduced-motion block, lazy images with alt text.',
  '- NEVER use an em dash. Use a comma, a colon or a full stop.',
  '- No lorem ipsum. No invented price, date, statistic or testimonial.',
  `- Phone for every call to action: ${F.phone}`,
  `- Photographs: hero ${HERO_IMG} ; detail ${DETAIL_IMG}`,
].join('\n');

const model = await getAgentModel({});

async function part(name: string, prompt: string): Promise<string> {
  const { text, finishReason, usage } = await generateText({ model, system, prompt, maxOutputTokens: 12000 });
  const out = String(text ?? '')
    .replace(/```(?:html|css)?/gi, '')
    .replace(/```/g, '')
    .trim();
  console.log(`  ${name}: ${out.length} chars (finish=${finishReason}, ${usage?.outputTokens ?? '?'} tokens)`);
  return out;
}

console.log('\nwriting the page in pieces');
const hero = await part(
  'hero',
  `Write ONLY the hero section markup. No <html>, no <style>, no commentary.
Full-bleed photograph as background (${HERO_IMG}) with a dark gradient scrim only behind the text.
Inside: eyebrow "${F.business}", H1 "${F.product}", one-sentence lede for ${F.audience},
a price lockup "${F.offer}" with "${F.then}" under it, a primary button "Book a call on WhatsApp" to https://wa.me/91${F.phone},
and the phone number as small text. Use these class names: hero, hero-media, hero-scrim, hero-inner, eyebrow, offer, offer-big, cta, note.`,
);

const middle = await part(
  'what you get',
  `Write ONLY this section markup. No <html>, no <style>, no commentary.
A "What you get" section: the four points as cards, each with a numeric label 01 to 04: ${F.highlights.join(' | ')}.
Use class names: section, cards, card, card-index, card-title.
Then a proof strip: ${F.proof.join(' | ')} using classes proof, proof-item.
Then a wide photograph section with ${DETAIL_IMG} and the caption "Your campaigns, run for you" using classes wide, wide-caption.`,
);

const close = await part(
  'faq and close',
  `Write ONLY this closing markup. No <html>, no <style>, no commentary.
An FAQ using <details>/<summary> with these exact pairs: ${F.faqs.map((f) => `"${f[0]}" => "${f[1]}"`).join(' | ')}.
Then a closing band: heading "Start with ${F.offer}" and the WhatsApp button to https://wa.me/91${F.phone}.
Then a <footer> with "${F.business}" and the phone. Use classes faq, close, cta, footer.`,
);

const cssBase = await part(
  'css: foundation',
  `Write ONLY CSS (no <style> tags, no commentary) for the page described so far.
This part is the FOUNDATION only: reset, :root variables for the palette, body typography with a clamp() type scale,
h1/h2 sizes, .eyebrow, .lede, .offer, .offer-big, .cta (44px min height, focus-visible ring), .note,
and the full-bleed hero: .hero, .hero-media img (object-fit cover), .hero-scrim (gradient behind text only), .hero-inner.
Include a prefers-reduced-motion block. Keep it under 95 lines. Stop after the hero rules.`,
);

const cssParts = await part(
  'css: components',
  `Write ONLY CSS (no <style> tags, no commentary) continuing the same stylesheet.
This part is COMPONENTS only: .section spacing rhythm, .cards (2 columns, 1 column under 720px), .card with padding and
a subtle border, .card-index in the accent colour with wide letter spacing, .card-title, .proof and .proof-item,
.wide and .wide-caption, .faq and details/summary styling with generous spacing, .close band, footer,
and a 720px media query for mobile. Keep it under 95 lines.`,
);

const cleanCopy = (html: string) => html.replace(/ — /g, ', ').replace(/—/g, '-');

const html = cleanCopy(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${F.business}: ${F.product}</title>
<meta name="description" content="${F.product} for ${F.audience}. ${F.offer}.">
<style>
${cssBase}
${cssParts}
</style>
</head>
<body>
${hero}
${middle}
${close}
</body>
</html>
`);

fs.writeFileSync('.tmp-model-page.html', html);
const qa = gradePageHtml(html);
console.log(`\nQA: ${qa.ok ? 'PASS' : 'FAIL'} (${html.length} bytes)`);
for (const finding of qa.findings) console.log(`  ${finding.ok ? 'ok  ' : 'FAIL'} ${finding.check} ${finding.detail}`);

const shot = await executeInE2BSandbox({
  files: [{ path: '/tmp/mpage/index.html', content: html }],
  command: [
    'BIN=$(find /tmp/gimg/browsers -name chrome-headless-shell -type f 2>/dev/null | head -1)',
    '[ -z "$BIN" ] && { echo NO_BROWSER; exit 4; }',
    '"$BIN" --no-sandbox --disable-gpu --hide-scrollbars --window-size=1280,3600 --screenshot=/tmp/mpage/desktop.png --virtual-time-budget=6000 file:///tmp/mpage/index.html 2>&1 | tail -2',
    'ls -la /tmp/mpage/desktop.png',
  ].join('\n'),
  readFiles: ['/tmp/mpage/desktop.png'],
  userId: 'gimg-browser-probe',
  timeoutMs: 200000,
});
const url = (shot.uploadedFiles as any)?.['/tmp/mpage/desktop.png'];
console.log('screenshot:', url ?? '(none)');
if (url) {
  const res = await fetch(url);
  fs.writeFileSync('.tmp-model-page.png', Buffer.from(await res.arrayBuffer()));
}
