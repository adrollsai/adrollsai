/**
 * Proves the vendored skills are legally shippable and that the router picks sensibly.
 *
 * Two different risks, one gate:
 *
 *   LICENCE   we are shipping ~64 KB of somebody else's writing into a commercial product.
 *             Every vendored skill must carry its repo, path, commit and a licence on the
 *             allow-list. If attribution is ever dropped to make something pass, this fails.
 *
 *   ROUTING   a router that quietly picks wrong is worse than no router: the agent follows
 *             the wrong instructions confidently. So the ranking is pinned against real
 *             phrasings an owner would actually type, and against the empty case, which must
 *             return NOTHING rather than a best guess.
 *
 *   npm run verify:vendor-skills
 */
import {
  ALLOWED_LICENCES,
  VENDORED_SKILLS,
  attributionLine,
  vendoredSkill,
  vendoredSkillCatalogue,
} from '../lib/agent/skills-vendor';
import { describeRoute, rankSkills, tokenise, type RoutableSkill } from '../lib/agent/skill-router';
import { HOUSE_SKILLS, houseSkillCatalogue } from '../lib/agent/house-skills';

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

head('1. We are allowed to ship these');
check(
  'every vendored skill carries its repo, path, commit and licence',
  VENDORED_SKILLS.every(
    (skill) =>
      skill.attribution.repo.includes('/') &&
      skill.attribution.path.endsWith('.md') &&
      skill.attribution.commit.length >= 7 &&
      skill.attribution.licence.length > 0 &&
      skill.attribution.url.startsWith('https://github.com/'),
  ),
  VENDORED_SKILLS.map(attributionLine).join(' | '),
);
check(
  'every licence is on the allow-list',
  VENDORED_SKILLS.every((skill) => (ALLOWED_LICENCES as readonly string[]).includes(skill.attribution.licence)),
  [...new Set(VENDORED_SKILLS.map((skill) => skill.attribution.licence))].join(', '),
);
check(
  'each body is real content, not a stub',
  VENDORED_SKILLS.every((skill) => skill.content.length > 2000 && skill.description.length > 10),
  VENDORED_SKILLS.map((skill) => `${skill.name}:${Math.round(skill.content.length / 1024)}KB`).join(' '),
);
check(
  'a vendored skill is readable by exact name, case-insensitively',
  vendoredSkill('ui-ux-pro-max') !== null &&
    vendoredSkill('UI-UX-PRO-MAX') !== null &&
    vendoredSkill('meta-ads-creative') !== null &&
    vendoredSkill('not-a-skill') === null,
  vendoredSkillCatalogue().map((skill) => skill.name).join(', '),
);

head('2. The router picks the skill a person would pick');

const routable: RoutableSkill[] = [
  ...houseSkillCatalogue().map((skill) => ({ ...skill, source: 'platform' as const })),
  ...vendoredSkillCatalogue().map((skill) => ({ ...skill, source: 'vendor' as const })),
];

/**
 * Real phrasings, and what must come back.
 *
 * `first` is used only where the intent is unambiguous. Where two skills genuinely both
 * apply — "landing page" is a platform editing rule AND a design skill — the test asks for
 * `any`, because demanding one of them would be pinning my opinion rather than the
 * behaviour. Getting a shortlist right is the router's job; picking the winner from an
 * ambiguous ask is the model's.
 */
const CASES: { ask: string; expect: string | null; mode?: 'first' | 'any' }[] = [
  { ask: 'make a vertical video for the course launch', expect: 'nobogent-video-brief', mode: 'first' },
  { ask: 'design a landing page layout for the webinar', expect: 'landing-structure', mode: 'any' },
  { ask: 'change the phone number on the landing page', expect: 'nobogent-page-editing', mode: 'first' },
  { ask: 'review the spacing and typography of this page', expect: 'ui-ux-pro-max', mode: 'any' },
  { ask: 'make a meta ad creative for a Diwali offer', expect: 'meta-ads-creative', mode: 'first' },
  { ask: 'design a banner for the top of the site', expect: 'banner-design', mode: 'first' },
  { ask: 'rebuild this reference video as an editable project', expect: 'nobogent-reference-video', mode: 'first' },
  { ask: 'what is my account balance', expect: null },
];

for (const entry of CASES) {
  const matches = rankSkills(entry.ask, routable);
  const shortlist = matches.map((match) => `${match.name}(${match.score})`).join(' ');
  if (entry.expect === null) {
    check(
      `"${entry.ask}" routes to NOTHING rather than a best guess`,
      matches.length === 0,
      matches.length ? `wrongly matched ${shortlist}` : 'no match',
    );
  } else if (entry.mode === 'any') {
    check(
      `"${entry.ask}" shortlists ${entry.expect}`,
      matches.some((match) => match.name === entry.expect),
      shortlist || 'no match',
    );
  } else {
    check(
      `"${entry.ask}" -> ${entry.expect}`,
      matches[0]?.name === entry.expect,
      shortlist || 'no match',
    );
  }
}

head('3. The router behaves like a router, not a search engine');
check(
  'a platform rule wins a tie with a vendor skill',
  (() => {
    // Same wording, one platform and one vendor skill describing the same thing: our own
    // rule must come first, because it encodes invariants the vendor never knew.
    const tie: RoutableSkill[] = [
      { name: 'nobogent-creative', description: 'image creative rules for ads and posts', source: 'platform' },
      { name: 'vendor-creative', description: 'image creative rules for ads and posts', source: 'vendor' },
    ];
    return rankSkills('image creative rules for ads', tie)[0]?.name === 'nobogent-creative';
  })(),
  'platform before vendor',
);
check(
  'an empty or stop-word-only requirement matches nothing',
  rankSkills('', routable).length === 0 && rankSkills('please can you help me with this', routable).length === 0,
  'no false positives',
);
check(
  'the number of picks is bounded, so the prompt cannot be flooded',
  rankSkills('landing page banner design image video creative meta', routable, { limit: 2 }).length <= 2,
  'limit honoured',
);
check(
  'the routing advice tells the agent to load ONE skill, not several',
  /ONE/.test(describeRoute('landing page', rankSkills('landing page', routable))) &&
    rankSkills('landing page', routable).length > 0,
  describeRoute('landing page', rankSkills('landing page', routable)).slice(0, 110),
);
check(
  'tokenising drops filler so the score means something',
  tokenise('please can you make me a landing page for the webinar').includes('landing') &&
    !tokenise('please can you make me a landing page').includes('please') &&
    !tokenise('please make it').includes('make'),
  tokenise('please can you make me a landing page for the webinar').join(' '),
);
check(
  'platform rules are still first-class alongside the vendor skills',
  HOUSE_SKILLS.length >= 5 && routable.filter((skill) => skill.source === 'platform').length === HOUSE_SKILLS.length,
  `${HOUSE_SKILLS.length} platform + ${VENDORED_SKILLS.length} vendor`,
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
