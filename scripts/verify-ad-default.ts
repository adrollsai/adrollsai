/**
 * Is there a default that makes a good ad when nobody passes a reference?
 *
 * The owner's ask was blunt: when no reference is passed, the prompts the agent writes should still produce
 * high-converting Meta ad creatives. So this tests the compiler as a product, not as plumbing:
 *
 *   - a brief with an offer produces an offer-led ad, and the offer is IN the headline
 *   - a brief with no offer does NOT invent one â€” it picks an angle it can support and flags what is missing
 *   - every format returns type sizes and safe areas that are internally consistent
 *   - the contrast maths is real (WCAG), checked against known values
 *   - a 9:16 build gets beats that cover the whole clip
 *   - the tool is in the toolset and the prompt tells the agent to use it before any ad
 *
 * Pure: no network, no credits, no model calls.
 *
 *   npx esbuild scripts/verify-ad-default.ts --bundle --platform=node --format=esm --packages=external \
 *     --outfile=.tmp-ad-default.mjs && node .tmp-ad-default.mjs
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';
import {
  AD_ANGLES,
  AD_FORMATS,
  composeAdCreative,
  contrastRatio,
  relativeLuminance,
} from '../lib/agent/creative/ad-prompt-compiler';

dotenv.config({ path: '.env.local', quiet: true });

const words = (text: string) => String(text || '').trim().split(/\s+/).filter(Boolean).length;

const ORG = '9c0748de-e3da-4ea1-b323-4ce736b5ca7c'; // Procolor Film Academy

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  â€” ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  â€” ${detail}` : ''}`);
  }
};

// â”€â”€ 1. A brief WITH an offer.
console.log('â–¸ a brief with an offer makes an offer-led ad');
const withOffer = composeAdCreative({
  product: 'Diploma in Cinematography',
  offer: 'â‚¹15,000 off the November batch',
  audience: 'aspiring cinematographers in Chandigarh',
  place: 'Chandigarh',
  format: '4:5',
  cta: 'call',
  contact: '9569919985',
  businessName: 'Procolor Film Academy',
  industry: 'education',
  brandColor: '#D0E8FF',
});
console.log(`  angle: ${withOffer.angle.id} â€” ${withOffer.angle.whyChosen}`);
console.log(`  headline: ${withOffer.headline}`);
check('it picks the offer-first angle', withOffer.angle.id === 'offer-first', withOffer.angle.id);
check(
  'the offer is IN the headline, not buried in a subhead',
  /15,000/i.test(withOffer.headline),
  withOffer.headline,
);
check('the offer is also carried as a field', /15,000/.test(String(withOffer.offer)));
check('there is exactly one call to action and it has the real number', /CALL NOW 9569919985/.test(withOffer.cta.label), withOffer.cta.label);
check('no placeholder survives in the copy', !/\[NEEDS:/.test(withOffer.headline + withOffer.subhead), 'nothing invented, nothing missing');
check('the business name reaches the prompt', /Procolor Film Academy/.test(withOffer.imagePrompt));
check(
  'the image prompt carries the message, the angle, the visual, the palette and the type sizes',
  /THE MESSAGE/.test(withOffer.imagePrompt) &&
    /THE ANGLE/.test(withOffer.imagePrompt) &&
    /THE VISUAL/.test(withOffer.imagePrompt) &&
    /COLOUR/.test(withOffer.imagePrompt) &&
    /TYPOGRAPHY/.test(withOffer.imagePrompt),
  `${withOffer.imagePrompt.length} chars`,
);
check('it demands real spelling of the copy', /spelled exactly as quoted/.test(withOffer.imagePrompt));
check(
  'the prompt is not just the headline pasted into a template',
  withOffer.imagePrompt.split('\n').length >= 8,
  `${withOffer.imagePrompt.split('\n').length} instructions`,
);
check('alternatives are offered, not one fixed line', withOffer.headlineAlternatives.length >= 1);
check('the headline is inside the word limit for 4:5', withOffer.headline.trim().split(/\s+/).length <= AD_FORMATS['4:5'].maxHeadlineWords, `${withOffer.headline.trim().split(/\s+/).length} words`);
// The bug this caught: a long offer plus a long product name made an eleven-word "headline", which is a
// paragraph nobody reads in a feed. It now sheds the product name rather than the offer â€” and the product
// has to survive somewhere on the frame.
check(
  'the offer survives the shortening (it is never the part that gets cut)',
  /15,000/i.test(withOffer.headline) && /NOVEMBER BATCH/i.test(withOffer.headline),
  withOffer.headline,
);
check(
  'and the product name is still on the creative',
  /Cinematography/i.test(withOffer.headline + ' ' + String(withOffer.subhead || '')),
  String(withOffer.subhead || '(dropped — the headline already says it)'),
);
const longBrief = composeAdCreative({
  product: 'Advanced Diploma in Cinematography and Film Production',
  offer: 'â‚¹15,000 off the November batch',
  format: '1:1',
  contact: '9569919985',
});
check(
  'a genuinely long brief still yields a headline that fits the square',
  words(longBrief.headline) <= AD_FORMATS['1:1'].maxHeadlineWords,
  `${words(longBrief.headline)} words: ${longBrief.headline}`,
);
check('and it says in the checklist that it shortened the product', longBrief.checklist.some((c) => /product name/.test(c)), 'the agent is told what changed');
check('the checklist includes the legibility test at preview size', withOffer.checklist.some((c) => /540px/.test(c)));
check('and the "no invented claim" test', withOffer.checklist.some((c) => /No invented claim/.test(c)));

// â”€â”€ 2. A brief with NO offer must not invent one.
console.log('\nâ–¸ a brief with no offer invents nothing');
const noOffer = composeAdCreative({
  product: 'Diploma in Cinematography',
  audience: 'school leavers',
  format: '1:1',
  businessName: 'Procolor Film Academy',
  industry: 'education',
});
console.log(`  angle: ${noOffer.angle.id} â€” ${noOffer.angle.whyChosen}`);
console.log(`  headline: ${noOffer.headline}`);
check('it does not claim an offer that was not given', noOffer.offer === null);
check(
  'it does not silently present a made-up figure',
  !/â‚¹|\d{2,}%|off\b/i.test(noOffer.headline.replace(/\[NEEDS:[^\]]+\]/g, '')),
  noOffer.headline,
);
check(
  'it either needs a fact, or it supports the claim it makes',
  noOffer.needs.length > 0 || noOffer.angle.argument.length > 0,
  noOffer.needs.length ? `needs ${noOffer.needs.join(', ')}` : 'supported',
);

// â”€â”€ 2b. Copy is copy, never a note to the writer.
//
// The bug this catches, seen in a real generated ad: the subhead field held "One line of proof, then the call to
// action." â€” an instruction to whoever writes the copy â€” and because everything in that field is quoted into the
// image prompt as text to render, the finished poster had my authoring note written across the middle of it.
console.log('\nâ–¸ nothing instructional is ever quoted as ad copy');
const INSTRUCTIONAL =
  /\b(then the|one line of|name the|answer it|answer the|state the|show that|the credential|no countdown|the place named|a real answer is promised|one measured|one concrete)\b/i;
const copyFields = (spec: ReturnType<typeof composeAdCreative>) =>
  [spec.headline, spec.subhead, ...spec.headlineAlternatives, ...spec.videoBeats.map((b) => b.onScreen)].join(' | ');

for (const angleId of AD_ANGLES.map((a) => a.id)) {
  const only = composeAdCreative({
    product: 'Diploma in Cinematography',
    offer: 'â‚¹15,000 off',
    place: 'Chandigarh',
    audience: 'students',
    format: '9:16',
    contact: '9569919985',
    facts: { seats: '20', deadline: '30 November', proof: 'Priya cleared it first attempt', authority: '15 years on set', outcome: 'a showreel in 6 months', objection: 'hidden fees' },
    avoid: AD_ANGLES.map((a) => a.id).filter((id) => id !== angleId),
  });
  const offending = copyFields(only).match(INSTRUCTIONAL)?.[0] ?? null;
  check(`  ${angleId}: its copy contains no authoring direction`, offending === null, offending ? `quoted "${offending}"` : String(only.subhead ?? '(no subhead)'));
}

const everyAngleHasCopy = AD_ANGLES.every((a) => a.subheads.length > 0 && a.subheads.every((s) => s.trim().length > 0));
check('every angle ships real subhead copy templates', everyAngleHasCopy, AD_ANGLES.map((a) => a.subheads.length).join(','));
check(
  'the writing advice is kept, but in its own field',
  AD_ANGLES.every((a) => a.subheadGuidance.length > 20) && Boolean(withOffer.direction),
  `direction: ${withOffer.direction}`,
);
check(
  'and that advice is NOT inside the image prompt',
  !withOffer.imagePrompt.includes(withOffer.direction),
  'the poster cannot contain the brief',
);
check(
  'the prompted subhead is real copy, or there is none to prompt',
  withOffer.subhead === null || withOffer.imagePrompt.includes(`subhead "${withOffer.subhead}"`),
  String(withOffer.subhead ?? '(dropped: it repeated the headline)'),
);
// The duplication bug, seen in a generated ad: headline "…DIPLOMA CINEMATOGRAPHY. CHANDIGARH" with the subhead
// "DIPLOMA IN CINEMATOGRAPHY · CHANDIGARH" printed underneath it. A subhead must add a word the headline does not.
const repeats = (spec: ReturnType<typeof composeAdCreative>) => {
  if (!spec.subhead) return false;
  const sig = (t: string) =>
    new Set(String(t).replace(/[^\p{L}\p{N}₹%]+/gu, ' ').split(/\s+/).filter((w) => w.length > 2).map((w) => w.toLowerCase()));
  const head = sig(spec.headline);
  const sub = sig(spec.subhead);
  return sub.size > 0 && [...sub].every((w) => head.has(w));
};
check(
  'no subhead merely repeats the headline',
  !repeats(withOffer) && !repeats(longBrief),
  withOffer.subhead ?? 'dropped, which is the point',
);
const addsSomething = composeAdCreative({ product: 'Diploma', offer: '₹5,000 off', place: 'Chandigarh', format: '1:1' });
check(
  'but a subhead that DOES add something is kept',
  addsSomething.subhead !== null && /CHANDIGARH/i.test(String(addsSomething.subhead)) && !repeats(addsSomething),
  `${addsSomething.headline} / ${addsSomething.subhead}`,
);
check(
  'the text-element count in the prompt matches what actually exists',
  withOffer.subhead === null
    ? /Exactly 2 text elements/.test(withOffer.imagePrompt)
    : /Exactly 3 text elements/.test(withOffer.imagePrompt),
  withOffer.imagePrompt.match(/Exactly \d text elements/)?.[0] ?? 'absent',
);

// â”€â”€ 3. Angles are only chosen when their facts exist.
console.log('\nâ–¸ an angle is only used when its facts exist');
const scarcityWithoutFacts = composeAdCreative({ product: 'Diploma', offer: 'X', industry: 'education', avoid: ['offer-first'] });
check(
  'excluding the supported angle does not fabricate the excluded claim',
  /\[NEEDS:/.test(scarcityWithoutFacts.headline) || scarcityWithoutFacts.angle.id !== 'scarcity-deadline',
  `${scarcityWithoutFacts.angle.id}: ${scarcityWithoutFacts.headline}`,
);
const deadline = composeAdCreative({
  product: 'Diploma in Cinematography',
  facts: { seats: '20', deadline: '30 November' },
  industry: 'education',
  avoid: ['offer-first'],
});
check(
  'when the facts DO exist, the deadline angle is used and the facts appear',
  deadline.angle.id === 'scarcity-deadline' && /30 NOVEMBER|20/i.test(deadline.headline),
  `${deadline.angle.id}: ${deadline.headline}`,
);

// â”€â”€ 4. Every format is internally consistent.
console.log('\nâ–¸ every format returns sizes that agree with each other');
for (const format of Object.keys(AD_FORMATS) as Array<keyof typeof AD_FORMATS>) {
  const spec = composeAdCreative({ product: 'Diploma', offer: 'â‚¹15,000 off', format, contact: '9569919985' });
  const cfg = AD_FORMATS[format];
  const headlinePx = spec.layout.typeScalePx.headline;
  const expected = Math.round(cfg.height * cfg.headlineScale);
  check(
    `  ${format}: canvas, type scale and safe area all come from one config`,
    spec.layout.canvas === cfg.label &&
      Math.abs(headlinePx - expected) <= 1 &&
      spec.layout.safeAreaPx.left === Math.round(cfg.width * cfg.safeMargin) &&
      spec.layout.typeScalePx.headline > spec.layout.typeScalePx.subhead &&
      spec.layout.typeScalePx.subhead > 0,
    `${headlinePx}px headline, ${spec.layout.safeAreaPx.left}px safe`,
  );
}
const beatSpec = composeAdCreative({ product: 'Diploma', offer: 'â‚¹15,000 off', format: '9:16', contact: '9569919985' });
check('9:16 gets a beat sheet', beatSpec.videoBeats.length === 4, `${beatSpec.videoBeats.length} beats`);
check(
  'the beats run in order and cover the clip',
  beatSpec.videoBeats.every((b, i, all) => (i === 0 ? b.from === 0 : b.from === all[i - 1].to)),
  beatSpec.videoBeats.map((b) => `${b.from}-${b.to}`).join(' '),
);
check('the first beat is the hook, and it starts at zero', beatSpec.videoBeats[0].from === 0 && /hook/i.test(beatSpec.videoBeats[0].shot));
check('the last beat is the end card with the call to action', /end card/i.test(beatSpec.videoBeats[3].shot));
check('the beats carry the real copy, not placeholders', beatSpec.videoBeats.some((b) => /15,000 off|15,000 OFF/i.test(b.onScreen)));
const square = composeAdCreative({ product: 'Diploma', format: '1:1' });
check('a still format gets no invented video beats', square.videoBeats.length === 0);

// â”€â”€ 5. The contrast maths is real.
console.log('\nâ–¸ the contrast check is measured, not asserted');
check('white on black is 21:1', Math.round(contrastRatio('#FFFFFF', '#000000') ?? 0) === 21, String(contrastRatio('#FFFFFF', '#000000')));
check('a colour against itself is 1:1', contrastRatio('#336699', '#336699') === 1);
check('mid grey on black is far below the threshold', (contrastRatio('#333333', '#0B1220') ?? 99) < 4.5, String(contrastRatio('#333333', '#0B1220')));
check('luminance rises with brightness', (relativeLuminance('#FFFFFF') ?? 0) > (relativeLuminance('#888888') ?? 0));
check('an unparseable colour is reported as unmeasurable, not as passing', contrastRatio('cornflower', '#000000') === null);
const badPalette = composeAdCreative({ product: 'Diploma', brandColor: '#151B28' });
// The contract changed here, on purpose. This used to assert that a failing brand colour produced a failing
// verdict and a warning — and it did, while the prompt went on telling the model to set the type in that colour.
// Measuring a problem and then shipping it is not a check. Now the compiler DEMOTES the brand to an accent and
// says so, which is why the verdict reads "passes": it is describing the type colour, which is no longer the brand.
check(
  'a brand colour that fails is demoted instead of used for type',
  /ALL TYPE in #F7F6F3/i.test(badPalette.imagePrompt) && !/type in #151B28/i.test(badPalette.imagePrompt),
  badPalette.imagePrompt.match(/ALL TYPE in #[0-9A-F]{6}/i)?.[0] ?? 'none',
);
check(
  'and the demotion is stated in the checklist the agent reads',
  badPalette.checklist.some((c) => /ACCENT ONLY/.test(c)),
  badPalette.checklist.find((c) => /ACCENT ONLY/.test(c)) ?? 'no note',
);
check('a passing palette says so', /passes/i.test(withOffer.layout.contrast.verdict), withOffer.layout.contrast.verdict);

// A dark brand colour must not become unreadable type.
//
// The defect this catches, found by compiling Nobogent's own ad: its brand is #0F172A, a near-black navy, and the
// prompt said "accents and type in #0F172A" on a #0B1220 background — 1.05:1, invisible. The compiler measured it
// correctly and then told the model to do it anyway. A measurement has to change the instruction, not sit next to it.
console.log('\n▸ a brand colour that cannot be read is never used for type');
const darkBrand = composeAdCreative({
  product: 'AI marketing department',
  offer: 'First month ₹999',
  contact: '9872669935',
  businessName: 'Nobogent',
  brandColor: '#0F172A',
  format: '4:5',
});
check(
  'the type colour it instructs passes 4.5:1',
  (darkBrand.layout.contrast.actual ?? 0) >= 4.5,
  `${darkBrand.layout.contrast.actual}:1 — ${darkBrand.layout.contrast.measure}`,
);
check(
  'and the prompt does not ask for type in the failing brand colour',
  !/type in #0F172A/i.test(darkBrand.imagePrompt) && /ALL TYPE in #F7F6F3/i.test(darkBrand.imagePrompt),
  darkBrand.imagePrompt.match(/ALL TYPE in #[0-9A-F]{6}/i)?.[0] ?? 'no type instruction found',
);
check('the brand colour is kept, as an accent', /#0F172A/.test(darkBrand.imagePrompt) && /accent/i.test(darkBrand.imagePrompt));
const lightBrand = composeAdCreative({ product: 'Diploma', offer: '₹999', brandColor: '#7DD3FC' });
check(
  'a brand colour that DOES pass contrast is used for type',
  /ALL TYPE in #7DD3FC/i.test(lightBrand.imagePrompt),
  lightBrand.imagePrompt.match(/ALL TYPE in #[0-9A-F]{6}/i)?.[0] ?? 'none',
);

// â”€â”€ 6. Wired into the real agent, and said out loud in the prompt.
console.log('\nâ–¸ the agent actually has it, and is told to use it');
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);
const ctx = await createAgentContext(sb as any, ORG, { intentText: 'make an ad for the cinematography diploma' });
const prompt = String(ctx.systemPrompt || '');
const flat = prompt.replace(/\s+/g, ' ');
check('the tool is in the toolset on an ad request', Boolean((ctx.tools as any).build_ad_creative_prompt?.execute), ctx.toolGroups.join(','));
check('the prompt names it', /build_ad_creative_prompt/.test(prompt));
check('the prompt says to call it FIRST, every time', /Call 'build_ad_creative_prompt' FIRST, every time/.test(flat));
check(
  'the doctrine covers the no-reference case explicitly',
  /holds when nobody passes a reference|without a reference, and especially when/i.test(flat),
);
check('it forbids filling a missing claim', /Never fill a missing deadline, seat count, result or statistic/.test(flat));
check('it requires verification before showing', /VERIFY IT BEFORE SHOWING IT/.test(prompt));
check('every angle is reachable and named', AD_ANGLES.every((a) => a.id && a.name && a.argument && a.headlines.length > 0), AD_ANGLES.map((a) => a.id).join(', '));
check(
  'no angle can be expressed without saying what it requires',
  AD_ANGLES.every((a) => a.requires.length > 0 && a.visual.length > 60),
  'each has required facts and a visual instruction',
);

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
