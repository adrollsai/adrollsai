/**
 * Can the owner say "no phone number on any daily creative", and "for THIS property, always like this"?
 *
 * THE CONTROL THAT WAS MISSING
 * Before this, a per-property instruction had nowhere to live, and "no number on the creative" could only
 * be said in prose the model might ignore — the compiler happily prints the contact into the image
 * instructions and turns it into a "Call" CTA. So the honest answer was "it can try".
 *
 * Now a directive is two things at once:
 *   instruction  prose for the model, carried in the routine brief;
 *   ban          a machine rule (phone, price, emoji, availability, deadline) ENFORCED on the compiled
 *                spec before an image is generated, and VERIFIED afterwards.
 *
 * The cases below are the owner's own examples, plus the two failure modes that matter: a per-property
 * rule leaking onto a different property, and a phone number surviving into the prompt.
 *
 *   npm run verify:creative-directives
 */
import fs from 'node:fs';

import {
  DIRECTIVE_BANS,
  applyDirectivesToSpec,
  directiveBriefLines,
  findViolations,
  mergeDirectives,
  scrubCopy,
  type CreativeDirectiveSet,
} from '../lib/automation/creative-directives';
import { composeAdCreative } from '../lib/agent/creative/ad-prompt-compiler';
import { composeRoutineBrief } from '../lib/automation/routine-composer';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? `  — ${detail}` : ''}`);
  }
};

const PROPERTY_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const PROPERTY_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

// Typed as the real shape so the doc-shaped fixtures below cannot drift from the
// parser they are meant to exercise (a `bans: [] as const` here used to make the
// whole file fail to typecheck while still running fine).
const set: CreativeDirectiveSet = {
  global: [{ id: 'g1', instruction: 'No phone number on any daily creative', bans: ['phone'] }],
  items: {
    [PROPERTY_A]: [
      { id: 'p1', instruction: 'Always show the site plan and the tower name', bans: [] },
      { id: 'p2', instruction: 'Never show a price for this project', bans: ['price'] },
    ],
    [PROPERTY_B]: [{ id: 'p3', instruction: 'Family lifestyle imagery only', bans: [] }],
  },
  campaigns: { cmp1: [{ id: 'c1', instruction: 'Use the festive palette', bans: [] }] },
};

// ── 1. scoping
console.log('\n▸ a rule applies exactly where it was said');
const globalOnly = mergeDirectives(set, {});
check('the global ban applies to a creative with no property', globalOnly.bans.includes('phone'), globalOnly.bans.join(', '));
check('and the property rules do not', !globalOnly.instructions.some((i) => /site plan/.test(i)));

const forA = mergeDirectives(set, { propertyId: PROPERTY_A });
check(
  'for property A: global ban + its own instructions + its own ban',
  forA.bans.includes('phone') && forA.bans.includes('price') && forA.instructions.some((i) => /site plan/.test(i)),
  `${forA.bans.join(', ')} | ${forA.instructions.length} instruction(s)`,
);
check(
  'property B rules do NOT leak onto A',
  !forA.instructions.some((i) => /Family lifestyle/.test(i)),
);
const forB = mergeDirectives(set, { propertyId: PROPERTY_B });
check('for property B: its rule, no price ban', forB.instructions.some((i) => /Family/.test(i)) && !forB.bans.includes('price'));
const forCampaign = mergeDirectives(set, { campaignId: 'cmp1' });
check('a campaign rule applies to its campaign only', forCampaign.instructions.some((i) => /festive/.test(i)) && !forCampaign.bans.includes('price'));
check('inactive directives are ignored', mergeDirectives({ global: [{ instruction: 'old rule', active: false }] }, {}).instructions.length === 0);
check('an unknown ban word is dropped, not obeyed blindly', mergeDirectives({ global: [{ instruction: 'x', bans: ['soul' as any] }] }, {}).bans.length === 0);
check('every allowed ban round-trips', mergeDirectives({ global: [{ instruction: 'x', bans: [...DIRECTIVE_BANS] }] }, {}).bans.length === DIRECTIVE_BANS.length);

// ── 2. the owner's exact case: no phone number on the creative
console.log('\n▸ "no phone number on the creative" is enforced, not suggested');
const withPhone = composeAdCreative({
  product: '3BHK at The Grand Crest',
  offer: 'Launch price ₹1.85 Cr',
  place: 'Mohali',
  format: '4:5',
  facts: { price: '₹1.85 Cr' },
  brandColor: '#0f766e',
  contact: '+919876543210',
  businessName: 'GNR HOMES',
  industry: 'real_estate',
} as any);
check(
  'the compiler DOES put the contact in when nothing forbids it',
  JSON.stringify(withPhone).includes('9876543210'),
  'this is the behaviour the directive has to override',
);

const directed = applyDirectivesToSpec(withPhone as any, forA);
const flat = JSON.stringify(directed.value);
check('with the directive, the number is gone from the whole spec', !/9876543210/.test(flat));
check('the contact field is dropped, so the CTA is not a call to nowhere', (directed.value as any).contact === undefined, directed.applied.join('; '));
check('the price is gone too (property A bans it)', !/1\.85\s*Cr|₹1\.85/.test(flat));
check('the image prompt tells the generator what not to draw', /Do NOT depict or write any of:.*phone/.test(String((directed.value as any).imagePrompt)));
check('and the check afterwards finds nothing to complain about', directed.violations.length === 0, JSON.stringify(directed.violations));

// ── 3. the check actually catches a violation
console.log('\n▸ and a violation is caught, not shipped');
check('a phone number in copy is found', findViolations('Call us on +91 98765 43210 today', ['phone']).length === 1);
check('a price is found', findViolations('Starting at ₹85,00,000 only', ['price']).length === 1);
check('an emoji is found', findViolations('Great offer 🎉', ['emoji']).length === 1);
check('an invented deadline is found', findViolations('Offer ends today only', ['deadline']).length === 1);
check('and clean copy passes', findViolations('Spacious 3BHK homes in Mohali', ['phone', 'price', 'emoji', 'deadline']).length === 0);
const scrubbed = scrubCopy('Book now on ₹1.85 Cr — call +91 98765 43210 🎉', ['phone', 'price', 'emoji']);
check('scrubbing removes all three and leaves readable copy', !/98765|₹|🎉/.test(scrubbed) && /Book now/.test(scrubbed), scrubbed);

// ── 4. the routine brief carries the rules
console.log('\n▸ the daily brief states them');
const brief = composeRoutineBrief({
  businessName: 'GNR HOMES',
  industry: 'real_estate',
  // The directives live INSIDE the playbook, under their own section — that is the shape the app stores
  // and the shape update_playbook patches.
  playbook: { positioning: 'Luxury homes in Tricity', creative_directives: set } as any,
  routine: {
    name: 'Daily marketing',
    intent: 'One strong creative a day, and follow up with open leads.',
    cadence: 'daily',
    approval_policy: 'always',
    daily_credit_cap: 200,
    channels: ['whatsapp'],
    timezone: 'Asia/Kolkata',
  },
  todaysDate: '2026-11-23',
  now: new Date('2026-11-23T04:00:00Z'),
} as any).text;

check('the brief names the standing rule', /No phone number on any daily creative/.test(brief));
check('it says the bans are checked mechanically', /HARD BANS, checked mechanically/.test(brief));
check('it lists the per-item rules with their ids', new RegExp(`item ${PROPERTY_A}`).test(brief) && /site plan/.test(brief));
check('and says to pass the id through', /pass its id as itemId to build_ad_creative_prompt/.test(brief));
check(
  'the brief lines are readable on their own',
  directiveBriefLines(forA).every((line) => line.length < 400),
  directiveBriefLines(forA)[1],
);

// ── 5. wired: the playbook section, the tool, the column
console.log('\n▸ wired end to end');
const playbookService = fs.readFileSync('lib/automation/playbook-service.ts', 'utf8');
check('creative_directives is a patchable playbook section', /'creative_directives',/.test(playbookService), 'so update_playbook can change it in words');
check('it is persisted on write', /creative_directives: \(built\.next as any\)\.creative_directives/.test(playbookService));
check('and loaded on read', /creative_directives'?\)/.test(playbookService) || /, creative_directives'/.test(playbookService));
const adTool = fs.readFileSync('lib/agent/tools/ad_creative.ts', 'utf8');
check('build_ad_creative_prompt applies them', /applyDirectivesToSpec\(/.test(adTool) && /mergeDirectives\(/.test(adTool));
check('and takes a propertyId', /propertyId: z/.test(adTool));
check('the routine brief imports the directives module', /from '\.\/creative-directives'/.test(fs.readFileSync('lib/automation/routine-composer.ts', 'utf8')));
check('a migration exists for the column', fs.existsSync('supabase/migrations/20261217000000_creative_directives.sql'));


// ── 6. the cron path and the vision check
console.log('\n▸ the paths the agent does not control');
const gateMod = await import('../lib/automation/creative-directive-gate');
const verifyMod = await import('../lib/automation/creative-verification');

const cronPrompt =
  'Premium Meta ad for GNR HOMES. Include contact info "+91 98765 43210" at the bottom and the price ₹1.85 Cr.';
const gatedPrompt = gateMod.gateCreative({
  prompt: cronPrompt,
  caption: 'Book now on ₹1.85 Cr — call +91 98765 43210',
  contact: '+919876543210',
  directives: forA,
});
check('the daily-creative prompt is scrubbed of the phone number', !/98765/.test(gatedPrompt.prompt), gatedPrompt.applied.join('; '));
check('and of the banned price', !/1\.85|₹/.test(gatedPrompt.prompt));
check('the caption is scrubbed too', !/98765|1\.85/.test(gatedPrompt.caption), gatedPrompt.caption);
check('the bans are stated to the generator', /Do NOT (depict|include|write)/i.test(gatedPrompt.prompt));
check('the owner instruction is carried into the prompt', /STANDING RULES/.test(gatedPrompt.prompt));
check('nothing is left blocked', gatedPrompt.blocked.length === 0, JSON.stringify(gatedPrompt.blocked));

// No directives at all. (The global phone ban applies to item B too, correctly — so item B is the
// wrong fixture for a no-op test.)
const cleanGate = gateMod.gateCreative({ prompt: 'A calm ad with no contact and no price', caption: '', contact: null, directives: { instructions: [], bans: [], sources: [] } });
check('an account with no applicable bans is left alone', cleanGate.prompt === 'A calm ad with no contact and no price');

const needed = verifyMod.expectedCheckCount(forA);
check('the check asks one question per rule plus legibility', needed === forA.instructions.length + forA.bans.length + 1, String(needed));
const question = verifyMod.buildVerificationPrompt(forA);
check('the question prompt demands machine-readable JSON', /Answer ONLY with JSON/.test(question));
check('and spells out one entry per question', /One entry per question/.test(question));

const passAnswer = JSON.stringify({
  checks: Array.from({ length: needed }, (_, i) => ({ rule: `rule ${i}`, pass: true, evidence: 'seen' })),
});
const passing = await verifyMod.verifyCreativeAgainstDirectives({
  imageUrl: 'https://x/y.jpg',
  directives: forA,
  analyse: async () => passAnswer,
});
check('a compliant creative passes', passing.ok === true && passing.checks.length === needed);

const failAnswer = JSON.stringify({
  checks: Array.from({ length: needed }, (_, i) => ({ rule: `rule ${i}`, pass: i !== 0, evidence: i === 0 ? 'no site plan visible' : 'seen' })),
});
const failing = await verifyMod.verifyCreativeAgainstDirectives({
  imageUrl: 'https://x/y.jpg',
  directives: forA,
  analyse: async () => failAnswer,
});
check('a creative missing the required element FAILS', failing.ok === false && /no site plan visible/.test(failing.failures.join(' ')));

const short = await verifyMod.verifyCreativeAgainstDirectives({
  imageUrl: 'https://x/y.jpg',
  directives: forA,
  analyse: async () => JSON.stringify({ checks: [{ rule: 'only one', pass: true, evidence: 'seen' }] }),
});
check('a partial answer is unverified, not a pass', short.ok === false && /unverified/.test(short.failures.join(' ')));

const garbled = await verifyMod.verifyCreativeAgainstDirectives({
  imageUrl: 'https://x/y.jpg',
  directives: forA,
  analyse: async () => 'looks fine to me!',
});
check('a reply that is not JSON fails closed', garbled.ok === false && /nothing usable/.test(garbled.failures.join(' ')));

const nullPass = await verifyMod.verifyCreativeAgainstDirectives({
  imageUrl: 'https://x/y.jpg',
  directives: forA,
  analyse: async () => JSON.stringify({ checks: Array.from({ length: needed }, () => ({ rule: 'r', pass: 'maybe', evidence: 'unclear' })) }),
});
check('a non-boolean verdict fails closed', nullPass.ok === false && /not a yes\/no/.test(nullPass.failures.join(' ')));

const threw = await verifyMod.verifyCreativeAgainstDirectives({
  imageUrl: 'https://x/y.jpg',
  directives: forA,
  analyse: async () => {
    throw new Error('vendor down');
  },
});
check('a failed vision call means unverified, not compliant', threw.ok === false && /could not run/.test(threw.failures.join(' ')));

const noRules = await verifyMod.verifyCreativeAgainstDirectives({
  imageUrl: 'https://x/y.jpg',
  directives: { instructions: [], bans: [], sources: [] },
  analyse: async () => 'x',
});
check('no rules means nothing to check, and no vendor call', noRules.ok === true && noRules.checks.length === 0);

const workerSource = fs.readFileSync('app/api/cron/auto-generate/worker/route.ts', 'utf8');
check('the daily-creative cron gates its prompt', /gateCreative\(/.test(workerSource) && /loadDirectivesFor\(/.test(workerSource));
check('and refuses to generate when a rule would be broken', /CREATIVE_RULES_BLOCKED/.test(workerSource));
check('and scrubs the caption it writes afterwards', /scrubbed the caption/.test(workerSource));
const adToolSourceForVerify = fs.readFileSync('lib/agent/tools/ad_creative.ts', 'utf8');
check('the agent has a verification tool', /verify_creative_against_directives: tool\(/.test(adToolSourceForVerify));
check('built on the shared verifier', /verifyCreativeAgainstDirectives\(/.test(adToolSourceForVerify));

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
