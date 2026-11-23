/**
 * Proves the ad-copy rules are real, and that the vendored playbook is reachable.
 *
 * WHAT THIS GATE IS FOR
 * The `ad-creative` skill is ~190 KB of somebody else's writing that we now ship, and its rules are
 * only worth anything if the product ENFORCES them. Two failure modes are being pinned here:
 *
 *   1. THE RULE BECOMES CEREMONY. Someone "improves" a limit to the API maximum (255 for a Meta
 *      headline) instead of the 40 characters a reader actually sees, and the truncation bug comes
 *      back with a passing test suite. The limits are asserted against the numbers the platforms
 *      truncate at, not against themselves.
 *
 *   2. THE SKILL BECOMES UNREACHABLE. A body that says "see references/platform-specs.md" points at
 *      a file that does not exist in this installation. If the reference layer breaks, the skill
 *      silently degrades into advice to read something the agent cannot open — which is worse than
 *      not shipping it, because it looks like it worked.
 *
 * The copy checks are also tested for FALSE POSITIVES, because a checker that flags real advertising
 * copy is a checker the agent learns to route around.
 *
 *   npm run verify:creative-specs
 */
import {
  AD_PLATFORMS,
  PLATFORM_COPY_SPECS,
  adCopyRulesForPrompt,
  checkAdCopy,
  checkField,
  checkTestHypothesis,
  copyLength,
  findCopyViolations,
  hasBlockingCopy,
  sanitizeCopy,
  trimToLimit,
  MECHANICALLY_REPAIRED_RULES,
} from '../lib/ads/creative-specs';
import {
  VENDORED_REFERENCES,
  VENDORED_SKILLS,
  ALLOWED_LICENCES,
  skillContentFor,
  vendoredReference,
  vendoredReferencesFor,
  vendoredSkill,
} from '../lib/agent/skills-vendor';
import { HOUSE_SKILLS, houseSkill } from '../lib/agent/house-skills';
import { rankSkills, type RoutableSkill } from '../lib/agent/skill-router';
import { DEFAULT_RECIPES } from '../lib/automation/recipes';
import { buildCampaignJobPayload, validateLaunchRequest } from '../lib/ads/launch-service';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}
const head = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);

head('1. The limits are the numbers a reader sees, not the API maximum');

check(
  'Meta headline is capped at 40, which is where Meta truncates',
  PLATFORM_COPY_SPECS.meta.fields.headline.limit === 40,
  `limit ${PLATFORM_COPY_SPECS.meta.fields.headline.limit}, absolute ${PLATFORM_COPY_SPECS.meta.fields.headline.absolute}`,
);
check(
  'primary text is capped at the 125 visible characters, not the 2,200 character maximum',
  PLATFORM_COPY_SPECS.meta.fields.primary_text.limit === 125 &&
    PLATFORM_COPY_SPECS.meta.fields.primary_text.absolute === 2200,
  `${PLATFORM_COPY_SPECS.meta.fields.primary_text.limit} enforced of ${PLATFORM_COPY_SPECS.meta.fields.primary_text.absolute}`,
);
check(
  'every platform we write for has at least a headline-length field',
  AD_PLATFORMS.length === 5 && AD_PLATFORMS.every((platform) => Object.keys(PLATFORM_COPY_SPECS[platform].fields).length > 0),
  AD_PLATFORMS.join(', '),
);
check(
  'every field carries the reason for its number, so nobody "simplifies" it later',
  AD_PLATFORMS.every((platform) =>
    Object.values(PLATFORM_COPY_SPECS[platform].fields).every((field) => field.note.length > 20),
  ),
  'all documented',
);

head('2. An over-long field comes back with a version that fits');

const LONG_HEADLINE = 'Book a site visit this Saturday and meet the team';
const long = checkField('meta', 'headline', LONG_HEADLINE);
check(
  `a ${LONG_HEADLINE.length}-character headline is reported as ${LONG_HEADLINE.length - 40} characters over`,
  long.over && long.truncatedBy === LONG_HEADLINE.length - 40 && long.length === LONG_HEADLINE.length,
  `${long.length}/${long.limit}, ${long.truncatedBy} hidden`,
);
check(
  'the trimmed alternative fits, cuts on a word boundary, and is a real prefix of the original',
  Boolean(long.trimmed) &&
    long.trimmed!.length <= 40 &&
    LONG_HEADLINE.startsWith(long.trimmed!) &&
    // It must end on a whole word: the character after it in the original is a space.
    LONG_HEADLINE[long.trimmed!.length] === ' ',
  JSON.stringify(long.trimmed),
);
check(
  'trimToLimit drops a trailing comma left by the cut',
  trimToLimit('Handover in March, ready to move, keys in hand', 32) === 'Handover in March, ready to',
  JSON.stringify(trimToLimit('Handover in March, ready to move, keys in hand', 32)),
);
check(
  'a single word longer than the limit still returns something usable',
  trimToLimit('Supercalifragilisticexpialidocious', 10).length > 0,
  JSON.stringify(trimToLimit('Supercalifragilisticexpialidocious', 10)),
);
check(
  'copy that fits is not touched',
  checkField('meta', 'headline', 'Site visits open Saturday').over === false,
  `${copyLength('Site visits open Saturday')} characters`,
);
check(
  'an unknown field is reported, not silently accepted as fitting',
  checkAdCopy('meta', { headline: 'Sites open Saturday', nonsense: 'x' } as any).unknownFields.join() ===
    'nonsense',
  'nonsense flagged',
);

head('3. Copy that reads as generated is caught');

const TELLS: [string, string][] = [
  ['Unlock the power of your next address', 'stock-phrase'],
  ['Say goodbye to long commutes', 'stock-phrase'],
  ['Your weekend, reimagined', 'stock-phrase'],
  ['Take it to the next level', 'stock-phrase'],
  ['Get started today', 'stock-phrase'],
  ['Here is the thing about possession dates', 'stock-phrase'],
  ['It is not just a flat, it is a lifestyle', 'contrast-reveal'],
  ['No fees, no delays, no hassle', 'stacked-negation'],
  ['The result? 3x faster handover', 'self-answered-question'],
  ['Site visits open Saturday — call now', 'dash'],
];
for (const [text, rule] of TELLS) {
  const found = findCopyViolations(text).map((issue) => issue.rule);
  check(`"${text.slice(0, 42)}" is caught as ${rule}`, found.includes(rule), found.join(', ') || 'nothing found');
}

check(
  'a stock phrase blocks a launch',
  hasBlockingCopy('Unlock the power of better living'),
  'severity block',
);
check(
  'a contrast reveal is reported but does NOT block, because a good ad can use one',
  findCopyViolations('It is not just a flat, it is a lifestyle').every((issue) => issue.severity === 'warn'),
  'warn only',
);
check(
  'every violation says what to write instead',
  findCopyViolations('Unlock the power of seamless living').every((issue) => issue.fix.length > 10),
  'each has a fix',
);

head('4. Real advertising copy is NOT flagged (a checker that cries wolf gets routed around)');

const GOOD = [
  'Site visits open this Saturday. Meet the team at the Mohali office.',
  'Two minutes from the Sector 82 metro. Handover in March.',
  '20 seats left in the November batch. Classes start 4 November.',
  'No card required to book a visit.',
  'Ask us about the possession date. We will show you the approval letter.',
  '85% of last year\'s batch cleared the exam on the first attempt.',
];
for (const text of GOOD) {
  const found = findCopyViolations(text);
  check(`"${text.slice(0, 44)}" passes clean`, found.length === 0, found.map((issue) => issue.rule).join(', ') || 'clean');
}
check(
  'one plain absence is fine — only three stacked negations are a tell',
  findCopyViolations('No card required.').length === 0 &&
    findCopyViolations('No fees, no delays, no hassle').length > 0,
  'one passes, three do not',
);

head('5. Mechanical repairs happen, judgement calls do not');

check(
  'an em dash becomes a full stop, and the new sentence starts with a capital',
  sanitizeCopy('Site visits open Saturday — call now').text === 'Site visits open Saturday. Call now',
  JSON.stringify(sanitizeCopy('Site visits open Saturday — call now').text),
);
check(
  'curly quotes and doubled words are straightened',
  sanitizeCopy('The  “ready  to  move”  flat flat').text === 'The "ready to move" flat',
  JSON.stringify(sanitizeCopy('The  “ready  to  move”  flat flat').text),
);
check(
  'a clean line is returned unchanged and reports no change',
  (() => {
    const clean = 'Site visits open Saturday. Call the team.';
    const result = sanitizeCopy(clean);
    return result.text === clean && result.changed.length === 0;
  })(),
  'no-op on clean copy',
);
check(
  'an over-long headline is NOT silently cut by the sanitiser',
  sanitizeCopy('Book a site visit this Saturday and meet the whole team at the office').text.length > 40,
  'length preserved — a rewrite is a writing problem',
);
check(
  'the dash rule is declared as mechanically repaired, so it cannot block a launch',
  (MECHANICALLY_REPAIRED_RULES as readonly string[]).includes('dash'),
  MECHANICALLY_REPAIRED_RULES.join(', '),
);

head('6. A hypothesis a result can prove wrong');

const BAD_HYPOTHESES = [
  'This will resonate with buyers.',
  'People will like this one more.',
  'More leads.',
];
for (const text of BAD_HYPOTHESES) {
  check(`"${text}" is rejected as unfalsifiable`, checkTestHypothesis(text).ok === false, checkTestHypothesis(text).missing.join(', '));
}
check(
  'a hypothesis naming metric, comparison and direction passes',
  checkTestHypothesis('Beats the current creative on CTR among site-visit leads, +15% or more').ok,
  'falsifiable',
);

head('7. The vendored playbook is present, licensed and reachable');

const adCreative = vendoredSkill('ad-creative');
check('the ad-creative skill is registered', adCreative !== null, adCreative ? `${Math.round(adCreative.content.length / 1024)} KB` : 'missing');
check(
  'it carries its repo, path, commit and licence',
  Boolean(adCreative) &&
    adCreative!.attribution.repo === 'coreyhaines31/marketingskills' &&
    adCreative!.attribution.path.endsWith('SKILL.md') &&
    adCreative!.attribution.commit.length >= 7 &&
    adCreative!.attribution.licence === 'MIT',
  adCreative ? `${adCreative.attribution.licence} @ ${adCreative.attribution.commit.slice(0, 8)}` : '',
);
check(
  'all eleven reference documents are vendored and licensed',
  vendoredReferencesFor('ad-creative').length === 11 &&
    VENDORED_REFERENCES.every(
      (reference) =>
        reference.belongsTo === 'ad-creative' &&
        reference.content.length > 500 &&
        (ALLOWED_LICENCES as readonly string[]).includes(reference.attribution.licence) &&
        reference.attribution.path.includes('/references/'),
    ),
  `${VENDORED_REFERENCES.length} references, ${Math.round(
    VENDORED_REFERENCES.reduce((total, reference) => total + reference.content.length, 0) / 1024,
  )} KB`,
);
check(
  'every vendored skill still carries an allowed licence',
  VENDORED_SKILLS.every((skill) => (ALLOWED_LICENCES as readonly string[]).includes(skill.attribution.licence)),
  [...new Set(VENDORED_SKILLS.map((skill) => skill.attribution.licence))].join(', '),
);
check(
  'a reference resolves by its full name AND by the short one an agent would try',
  vendoredReference('ad-creative--platform-specs') !== null &&
    vendoredReference('platform-specs') !== null &&
    vendoredReference('nope') === null,
  'both forms resolve',
);
check(
  'the skill body is handed over with a pointer to its references, because the upstream paths do not exist here',
  (() => {
    const body = skillContentFor(adCreative!);
    return (
      body.includes('get_skill_reference') &&
      body.includes('ad-creative--platform-specs') &&
      body.includes('the platform rule wins')
    );
  })(),
  'pointer block present',
);
check(
  'a skill with no references gets no pointer block',
  !skillContentFor(vendoredSkill('scroll-craft')!).includes('REFERENCE DOCUMENTS'),
  'clean body',
);

head('8. The rule is always in view, and routable');

const houseCopy = houseSkill('nobogent-ad-copy');
check('the nobogent-ad-copy platform rule exists', houseCopy !== null, houseCopy ? `${Math.round(houseCopy.content.length / 1024)} KB` : 'missing');
check(
  'it states the enforced limit and the skill to load',
  Boolean(houseCopy) && houseCopy!.content.includes('40') && houseCopy!.content.includes('ad-creative'),
  'cites the budget and the playbook',
);
check(
  'every house skill is in the prompt catalogue, so the rule is never optional',
  HOUSE_SKILLS.some((skill) => skill.name === 'nobogent-ad-copy'),
  `${HOUSE_SKILLS.length} platform rules`,
);

const routable: RoutableSkill[] = [
  ...HOUSE_SKILLS.map((skill) => ({ name: skill.name, description: skill.description, source: 'platform' as const })),
  ...VENDORED_SKILLS.map((skill) => ({
    name: skill.name,
    description: `${skill.description} Use for: ${skill.useFor}`,
    source: 'vendor' as const,
  })),
];
check(
  'a request to write ad copy reaches an ad-copy rule',
  rankSkills('write a headline and primary text for my ad', routable).some((match) =>
    ['nobogent-ad-copy', 'ad-creative', 'meta-ads-creative'].includes(match.name),
  ),
  rankSkills('write a headline and primary text for my ad', routable)
    .map((match) => `${match.name}(${match.score})`)
    .join(' '),
);
check(
  'a meta ad request still picks meta-ads-creative first, so the new rule did not crowd out routing',
  rankSkills('make a meta ad creative for a Diwali offer', routable)[0]?.name === 'meta-ads-creative',
  rankSkills('make a meta ad creative for a Diwali offer', routable)
    .map((match) => `${match.name}(${match.score})`)
    .join(' '),
);
check(
  'an unrelated request still matches nothing rather than a creative skill',
  rankSkills('what is my account balance', routable).length === 0,
  'no false positive',
);

head('9. The routine flow carries the same rule');

check(
  'the daily creative recipe forbids copy that reads as generated',
  JSON.stringify(DEFAULT_RECIPES.creative.avoid).toLowerCase().includes('generated'),
  'creative.avoid',
);
check(
  'the daily copy recipe asks for one argument, chosen before writing',
  JSON.stringify(DEFAULT_RECIPES.copy.structure).toLowerCase().includes('one argument'),
  'copy.structure',
);
check(
  'the creative recipe states the headline character budget',
  JSON.stringify(DEFAULT_RECIPES.creative.must_include).includes('40'),
  'creative.must_include',
);
const rules = adCopyRulesForPrompt();
check(
  'the prompt block states the enforced numbers, not the API maxima',
  rules.includes('headline ≤40') && rules.includes('primary_text ≤125') && rules.includes('description ≤30'),
  'meta limits quoted',
);
check(
  'the prompt block names the banned phrases and the structural tells',
  rules.includes('unlock the power') && rules.includes('contrast reveals') && rules.includes('POV'),
  'bans quoted',
);
check(
  'a per-platform block narrows to that platform only',
  adCopyRulesForPrompt('google_ads').includes('headline ≤30') &&
    !adCopyRulesForPrompt('google_ads').includes('primary_text'),
  'google only',
);

head('10. The launcher refuses the copy, and repairs the punctuation');

/**
 * The integration proof.
 *
 * Everything above tests the module. This tests the thing the owner actually experiences: a launch
 * request carrying bad copy is refused BEFORE anything is created, and the refusal quotes a version
 * that fits. Testing the module alone would leave the wiring unproven — the exact gap that let
 * `describe('Max 40 characters')` sit in the tool schema for a year while Meta truncated headlines.
 */
const baseRequest = { dailyBudget: 500, campaignType: 'whatsapp_chat' } as any;

const refusedForStock = validateLaunchRequest({
  ...baseRequest,
  adCopy: { headline: 'Unlock the power of your next address', primary_text: 'Book a visit.' },
});
check(
  'a stock phrase in the headline is refused with a rewrite instruction',
  refusedForStock.ok === false &&
    /rewrite/i.test(refusedForStock.error || '') &&
    /Unlock the power/i.test(refusedForStock.error || ''),
  (refusedForStock.error || '').slice(0, 150),
);
check(
  'the refusal says no money was spent, so the reader knows the state of the world',
  /no money was spent/i.test(refusedForStock.error || ''),
  'states the outcome',
);

const refusedForLength = validateLaunchRequest({
  ...baseRequest,
  adCopy: { headline: LONG_HEADLINE, primary_text: 'Book a visit.' },
});
const fittingHeadline = trimToLimit(LONG_HEADLINE, 40);
check(
  'a headline that Meta would truncate is refused, and a fitting version is quoted',
  refusedForLength.ok === false &&
    /headline is \d+ characters/.test(refusedForLength.error || '') &&
    (refusedForLength.error || '').includes(fittingHeadline),
  (refusedForLength.error || '').slice(0, 170),
);

const refusedForDash = validateLaunchRequest({
  ...baseRequest,
  adCopy: { headline: 'Site visits open Saturday — call now', primary_text: 'Book a visit.' },
});
check(
  'a dash alone does NOT refuse the launch, because it is repaired instead',
  !/rewrite/i.test(refusedForDash.error || ''),
  (refusedForDash.error || 'no copy refusal').slice(0, 120),
);

const sanitised = buildCampaignJobPayload(
  {
    token: 't',
    adAccountId: 'a',
    pageId: 'p',
    businessName: 'Procolor Film Academy',
    currency: 'INR',
    userId: 'u',
  } as any,
  {
    ...baseRequest,
    adCopy: { headline: 'Site visits open Saturday — call now', primary_text: 'Book  a  visit.' },
  } as any,
  (refusedForDash.plan || {}) as any,
);
check(
  'the payload that reaches Meta has the dash repaired and the spacing collapsed',
  !/[—–]/.test(sanitised.adCopy.headline) && !/ {2}/.test(sanitised.adCopy.primary_text),
  JSON.stringify(sanitised.adCopy),
);
check(
  'clean copy passes validation untouched',
  (() => {
    const result = validateLaunchRequest({
      ...baseRequest,
      adCopy: { headline: 'Site visits open Saturday', primary_text: 'Meet the team at the Mohali office.' },
    });
    return !/rewrite/i.test(result.error || '');
  })(),
  'not refused for copy',
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
