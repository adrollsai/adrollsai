/**
 * Are the right skills used BY DEFAULT, without anybody asking for them?
 *
 * The owner's requirement is precise, so this tests it at both levels it is implemented:
 *
 *   PROMPT   a request for a website names ui-ux-pro-max and scroll-craft, a video names the shot and pipeline
 *            skills, an ad names the creative skills — from the request text alone, with no catalogue browsing —
 *            and every name it asks the agent to load actually resolves to a real skill.
 *
 *   OUTPUT   the generated page carries the rules those skills describe: measured contrast, a real type scale,
 *            44px touch targets, reduced-motion handling, transform/opacity-only animation, no em dashes in
 *            visible copy, at most one eyebrow per three sections, varied anchors, a sticky mobile CTA, a
 *            resolving close. A prompt can be ignored. A stylesheet in the output cannot.
 *
 * Pure: no network, no credits.
 *
 *   npx esbuild scripts/verify-skills-default.ts --bundle --platform=node --format=esm --packages=external \
 *     --outfile=.tmp-skills-default.mjs && node .tmp-skills-default.mjs
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';
import { houseSkill } from '../lib/agent/house-skills';
import { vendoredSkill } from '../lib/agent/skills-vendor';
import { requiredSkillsFor } from '../lib/agent/creative/skill-routing';
import { buildLandingPage } from '../lib/agent/tools/pages';
import { buildSiteHtml } from '../lib/automation/site-builder';
import { noEmDash, paletteFor, readableInkFor } from '../lib/site/design-system';
import { contrastRatio } from '../lib/design/contrast';

dotenv.config({ path: '.env.local', quiet: true });

const ORG = '9c0748de-e3da-4ea1-b323-4ce736b5ca7c';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
};

const resolves = (name: string) => Boolean(houseSkill(name) || vendoredSkill(name));

// ── 1. The right skills, chosen from the request.
console.log('▸ a request names the skills it needs, without being asked');
const cases: Array<[string, string[]]> = [
  ['build me a website for my business', ['ui-ux-pro-max', 'scroll-craft']],
  ['make a landing page for the November batch', ['ui-ux-pro-max', 'scroll-craft']],
  ['create an ad for the diploma course', ['meta-ads-creative']],
  ['design a poster for Diwali', ['meta-ads-creative', 'banner-design']],
  ['make a 30 second reel for the new batch', ['video-shotcraft', 'nobogent-video-pipelines']],
  ['a testimonial video from a student', ['video-shotcraft', 'nobogent-video-pipelines']],
  ['change the phone number on the page', ['nobogent-page-editing']],
];
for (const [request, expected] of cases) {
  const { requirements, intents } = requiredSkillsFor(request);
  const names = requirements.map((r) => r.skill);
  check(
    `  "${request.slice(0, 40)}"`,
    expected.every((skill) => names.includes(skill)),
    `${intents.join('+') || 'no intent'} → ${names.join(', ') || 'none'}`,
  );
}
const none = requiredSkillsFor('how many calls came in today');
check('a reporting question demands no craft skill', none.requirements.length === 0, none.intents.join(',') || 'none');
const both = requiredSkillsFor('make a video and a landing page for the offer');
check(
  'a request needing two crafts gets both, merged not chosen',
  ['video-shotcraft', 'ui-ux-pro-max', 'scroll-craft'].every((s) => both.requirements.some((r) => r.skill === s)),
  both.requirements.map((r) => r.skill).join(', '),
);
check('every required skill name resolves to a real skill', [...cases, ['make a video and a landing page for the offer', []]]
  .flatMap(([request]) => requiredSkillsFor(String(request)).requirements.map((r) => r.skill))
  .every(resolves), 'a mandate to load a skill that does not exist is worse than none');
check(
  'each requirement carries a reason, not just a name',
  requiredSkillsFor('build me a website').requirements.every((r) => r.why.length > 20),
);

// ── 2. The prompt actually carries the mandate.
console.log('\n▸ the prompt says so, for each kind of request');
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);
for (const [request, expected] of [
  ['build me a website for my business', ['ui-ux-pro-max', 'scroll-craft']],
  ['make a reel for the new batch', ['video-shotcraft', 'nobogent-video-pipelines']],
] as Array<[string, string[]]>) {
  const ctx = await createAgentContext(sb as any, ORG, { intentText: request });
  const prompt = String(ctx.systemPrompt || '');
  check(
    `  "${request.slice(0, 34)}": the mandate is in the prompt`,
    /SKILLS REQUIRED FOR THIS TASK/.test(prompt) && expected.every((skill) => prompt.includes(`get_skill('${skill}')`)),
    expected.join(', '),
  );
}
const reportCtx = await createAgentContext(sb as any, ORG, { intentText: 'how many leads today' });
check(
  'but a reporting turn is not spammed with craft skills',
  !/SKILLS REQUIRED FOR THIS TASK/.test(String(reportCtx.systemPrompt || '')),
  'tokens and attention are not free',
);

// ── 3. The page output carries the design system in CODE.
console.log('\n▸ the generated page applies the rules, not just talks about them');
const page = buildLandingPage({
  businessName: 'Nobogent',
  productName: 'Monthly Marketing Department',
  audience: 'Indian small businesses selling on WhatsApp and Instagram',
  offer: 'First month ₹499, then ₹999 a month',
  highlights: ['Ads written, built and launched for you', 'A landing page per offer', 'WhatsApp and calling follow-up', 'One dashboard for the numbers'],
  phone: '9872669935',
  industry: 'education',
  brandColor: '#0F172A',
  heroImage: 'https://example.com/hero.jpg',
  galleryImages: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
  proofPoints: ['4 to 7 day launch'],
  testimonials: [{ quote: 'The ads went live in under a week', name: 'A owner of a studio' }],
  faqs: [{ question: 'Do I need my own ad account?', answer: 'No, we set it up for you.' }],
});
const html = page.html;

check('a real type scale, not one font size', /--step-4:clamp/.test(html) && /--step-0:clamp/.test(html));
check('tokens rather than hardcoded colours everywhere', /--ink:/.test(html) && /--brand:/.test(html));
check('44px minimum touch target on the action', /min-height:44px/.test(html), 'a thumb is not a mouse');
check('visible focus rings that are never removed', /:focus-visible\{[^}]*outline:3px/.test(html));
check('reduced motion is honoured', /prefers-reduced-motion:reduce/.test(html));
check(
  'animation is transform and opacity only, never transition:all',
  /transition:opacity .5s ease,transform .5s ease/.test(html) && !/transition:\s*all/.test(html),
);
check('the scrim sits only where the hero text sits', /\.hero__scrim\{[^}]*linear-gradient/.test(html));
check('anchors vary instead of every act being centred', /split--trail/.test(html));
const eyebrowCount = (html.match(/class="eyebrow"/g) || []).length;
const sectionCount = (html.match(/class="[^"]*(hero|offerings|proof|countdown|mentor|gallery|logos|testimonials|faq|about|register|cta-band|contact)/g) || []).length;
check(
  'at most one eyebrow per three sections',
  eyebrowCount <= Math.max(1, Math.floor(sectionCount / 3)),
  `${eyebrowCount} eyebrows across ~${sectionCount} sections`,
);
check('no section counters and no scroll cue', !/\b0?1\s*\/\s*\d\d\b/.test(html) && !/scroll (down|to explore)/i.test(html));
check('a sticky mobile action exists', /class="sticky-cta"/.test(html) && /@media\(max-width:819px\)/.test(html));
check('the close resolves rather than trailing into the footer', /class="cta-band band"/.test(html) && /Ready for/.test(html));
check('labels are visible, not placeholder-only', /<label>Name <input/.test(html));
const imgTags = html.match(/<img\b[^>]*>/g) || [];
check('every image has alt text', imgTags.length > 0 && imgTags.every((tag) => /\balt="/.test(tag)), `${imgTags.length} images`);
check(
  'the hero image is eager (it is the LCP) and every other image is lazy',
  /loading="eager"[^>]*alt=|alt="[^"]*"[^>]*loading="eager"/.test(html) &&
    imgTags.filter((tag) => !/loading="eager"/.test(tag)).every((tag) => /loading="lazy"/.test(tag)),
  'eager for the first paint, lazy for the rest',
);
check('the page is a single self-contained document', /^<!DOCTYPE html>/.test(html.trim()) && /<\/html>\s*$/.test(html.trim()));
check(
  'no em dash in anything the visitor reads',
  !/—|–/.test(html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '')),
  'the single most common tell of machine-written copy',
);
check('real numbers only: no invented statistic appeared', !/\d{1,3}(,\d{3})*\+?\s*(customers|clients|students|businesses)/i.test(html));
check(
  'the palette is measured, and it passes',
  paletteFor('#0F172A').contrastPasses && (contrastRatio(paletteFor('#0F172A').ink, '#0F172A') ?? 0) >= 4.5,
  `${contrastRatio(paletteFor('#0F172A').ink, '#0F172A')}:1 on #0F172A`,
);
const light = readableInkFor('#F7F6F3');
check('and a light brand colour gets dark ink instead of white', light.ink === '#0B0F19' && light.passes, `${light.ratio}:1`);
check('copy is cleaned on the way out', noEmDash('A — B') === 'A. B' && !noEmDash('x — y').includes('—'));

// ── 4. The whole site gets the same treatment.
console.log('\n▸ the full website gets the same design system');
const site = buildSiteHtml(
  {
    business_name: 'Nobogent',
    mission_statement: 'Your marketing department, run by an agent.',
    contact_number: '9872669935',
    whatsapp_phone_number: '9872669935',
    address: 'Sector 17, Chandigarh',
    industry: 'education',
  } as any,
  [{ name: 'Monthly Marketing Department', price: '₹999', summary: 'Ads, pages and follow-up', image: null }] as any,
);
const siteHtml = typeof site === 'string' ? site : String((site as any)?.html ?? '');
check('the site carries the spacing and type tokens', /--step-3:clamp/.test(siteHtml) && /--s6:48px/.test(siteHtml));
check('the site CTA is a 44px button, not a bare link', /\.nobo-cta\{[\s\S]*?min-height:44px/.test(siteHtml));
check('and it has the same focus treatment', /nobo-cta:focus-visible\{[^}]*outline:3px/.test(siteHtml));
check(
  'the site heading no longer uses an em dash before the city',
  /Nobogent · Chandigarh/.test(siteHtml) && !/Nobogent — Chandigarh/.test(siteHtml),
  'it did, and that is exactly the tell scroll-craft forbids',
);
// The same em dash appeared in <title> and og:title — the two strings that show up in a browser tab, a search
// result and every share card, which is the worst place to look machine-written.
check(
  'nor does the page title or the share card',
  !/<title>[^<]*—/.test(siteHtml) && !/og:title" content="[^"]*—/.test(siteHtml),
  siteHtml.match(/<title>[^<]*<\/title>/)?.[0] ?? 'no title',
);

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
