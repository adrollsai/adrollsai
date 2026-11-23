/**
 * Vendor the open-source skills the owner approved, straight from upstream.
 *
 * WHY A SCRIPT AND NOT PASTED FILES
 * These are ~60 KB of somebody else's writing. Copying them by hand invites silent
 * drift: a typo in one word, a section quietly dropped, no way to tell which upstream
 * commit you are running. This script downloads each file, records the commit and the
 * licence beside it, and writes a typed module. Re-running it REFRESHES the vendored
 * copies, and the gate fails if any of them has lost its attribution.
 *
 * LICENCES, VERIFIED NOT ASSUMED
 *   nateherkai/scroll-craft              MIT
 *   nextlevelbuilder/ui-ux-pro-max-skill MIT
 *   cdeistopened/content-os              MIT
 * All three permit commercial use with attribution, which is what `attribution` below is
 * for. If a licence ever stops being MIT, the gate has to be told — not quietly ignored.
 *
 *   node scripts/vendor-skills.mjs            # refresh every vendored skill
 *   node scripts/vendor-skills.mjs --check    # report drift against upstream, write nothing
 *   node scripts/vendor-skills.mjs --only=ad-creative-ad-creative-ref-platform-specs
 *                                             # refresh named slugs only (comma-separated)
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.join('lib', 'agent', 'skills-vendor');

// ── ad-creative (coreyhaines31/marketingskills, MIT) ─────────────────────────────────────────────────────────
//
// The performance-creative playbook: platform character limits, the angle system, the "no AI tells" copy
// blacklist, the grounded-inputs corpus, the static template library and the strategy loop that turns last
// month's results into next month's briefs.
//
// WHY THE REFERENCE FILES ARE VENDORED SEPARATELY RATHER THAN INLINED
// SKILL.md is 27 KB and points at eleven further documents totalling ~160 KB. Pasting that into one skill body
// would spend a turn's whole prompt budget on a document the agent reads once and mostly does not need; and
// dropping the references would leave the skill telling the agent to read files that are not there. So the body
// ships as the `ad-creative` skill and each reference ships as a companion the agent fetches by name, which is
// the same progressive disclosure the rest of this directory uses — just one level deeper.
//
// Licensed MIT (Copyright (c) 2025 Corey Haines). Attribution is mandatory and the gate enforces it; the
// upstream `evals/evals.json` fixture and the `assets/creative-review-template.html` delivery template are
// deliberately NOT vendored — the first is their test harness, the second duplicates `app/review`.
const AD_CREATIVE = {
  repo: 'coreyhaines31/marketingskills',
  root: 'skills/ad-creative',
  licence: 'MIT',
};

/**
 * `[slug, title, why]` for each of the skill's own reference documents.
 *
 * The slug is deliberately IDENTICAL to the upstream basename, so the attribution URL and
 * `get_skill_reference` name never drift from the file they claim to be: `meta-creative-formats`
 * and not a tidied-up `meta-formats`.
 */
const AD_CREATIVE_REFERENCES = [
  [
    'platform-specs',
    'Platform specs',
    'Character and quantity limits for every ad platform and placement, with the format variations each one ' +
      'accepts. This is the table that stops Meta truncating a headline at 40 characters without warning.',
  ],
  [
    'static-ad-templates',
    'Static ad templates',
    'The static layout library — Us vs. Them, Stat Callout, Before/After, Founder Message, FAQ Card, Grid, ' +
      'Callout, Guarantee, Without — each tiered S–F with its funnel role and copy slots.',
  ],
  [
    'hook-system',
    'Hook system',
    'How the first line earns the next second, plus funnel-stage diagnosis: which hook a problem-aware reader ' +
      'needs versus a product-aware one.',
  ],
  [
    'awareness-headlines',
    'Awareness headlines',
    'Choosing the headline treatment from the reader\'s stage of awareness, with the mobile-readable visual ' +
      'spec for text-led statics.',
  ],
  [
    'meta-creative-formats',
    'Meta creative formats',
    'About 51 Meta creative formats ranked S to F by one question: does it puncture a cold audience, or only ' +
      'convert people already in the funnel. Use it to decide which format to make NEXT.',
  ],
  [
    'creative-roadmap',
    'Creative roadmap',
    'The strategy loop: evidence-ranked concepts from three signal sources, an exploration-versus-scaling mix, ' +
      'a capacity-checked roadmap with production tiers, and the monthly retro that feeds the next slate.',
  ],
  [
    'creative-review-page',
    'Creative review page',
    'The data model and grounding rules for a self-contained creative-review page a client picks from, ' +
      'including the disclosure block that is required.',
  ],
  [
    'generative-tools',
    'Generative tools',
    'Which image, video, voice and code-based tool makes which kind of ad, with per-platform image specs and a ' +
      'cost comparison. Cross-check it against our own model registry before calling a vendor.',
  ],
  [
    'short-form-video-specs',
    'Short-form video',
    'Creator and UGC short-form format library, plus the vertical video production spec that governs ALL 9:16 ' +
      'work: the 720×1200 text-safe band, the caption recipe, and the organic-versus-baked-music decision.',
  ],
  [
    'motion-video-ads',
    'Motion video ads',
    'Faceless motion-style ads end to end: styled stills, image-to-video, TTS, word-timed captions, nine visual ' +
      'styles, and the QC gotchas that only show up at delivery.',
  ],
  [
    'imessage-video-ads',
    'iMessage video ads',
    'The iOS-native reveal formats — iMessage thread, ChatGPT, Apple Notes, AirDrop — with scripting, pacing, ' +
      'and the compliance rules that apply to a dramatised conversation.',
  ],
];

function adCreativeFamily() {
  const entries = [
    {
      slug: 'ad-creative',
      name: 'ad-creative',
      repo: AD_CREATIVE.repo,
      filePath: `${AD_CREATIVE.root}/SKILL.md`,
      licence: AD_CREATIVE.licence,
      why:
        'The performance-creative playbook: angles, platform character limits, the copy blacklist that stops ' +
        'output reading as machine-written, grounded inputs, and the loop that turns last month\'s results into ' +
        'next month\'s briefs. Load it before writing ANY ad copy, headline or offer line.',
    },
  ];
  for (const [slug, title, why] of AD_CREATIVE_REFERENCES) {
    entries.push({
      slug: `ad-creative-ref-${slug}`,
      name: `ad-creative--${slug}`,
      title,
      kind: 'reference',
      belongsTo: 'ad-creative',
      repo: AD_CREATIVE.repo,
      filePath: `${AD_CREATIVE.root}/references/${slug}.md`,
      licence: AD_CREATIVE.licence,
      why,
    });
  }
  return entries;
}

/**
 * Everything we vendor, and the exact upstream file it came from.
 *
 * `kind: 'reference'` marks a companion file that is NOT its own skill: it is one of the
 * `references/*.md` documents an upstream SKILL.md points at. References are emitted as a
 * separate shape and are loaded by `get_skill_reference` rather than `get_skill`, so they
 * never take a slot in the skill catalogue — an upstream skill's footnotes should not cost
 * every routing decision a prompt line.
 */
const SOURCES = [
  {
    slug: 'meta-ads-creative',
    name: 'meta-ads-creative',
    repo: 'cdeistopened/content-os',
    filePath: 'skills/social/meta-ads-creative/SKILL.md',
    licence: 'MIT',
    why: 'Meta ad creative specs and structure — pair it with plan_image, which knows our flare model.',
  },
  {
    slug: 'scroll-craft',
    name: 'scroll-craft',
    repo: 'nateherkai/scroll-craft',
    filePath: 'plugins/nateherk-design/skills/scroll-craft/SKILL.md',
    licence: 'MIT',
    why: 'Landing-page layout that survives a thumb-scroll — feeds create_landing_page.',
  },
  {
    slug: 'ui-ux-pro-max',
    name: 'ui-ux-pro-max',
    repo: 'nextlevelbuilder/ui-ux-pro-max-skill',
    filePath: '.claude/skills/ui-ux-pro-max/SKILL.md',
    licence: 'MIT',
    why: 'UI/UX review rules — the design judgement a generated page is missing.',
  },
  {
    slug: 'banner-design',
    name: 'banner-design',
    repo: 'nextlevelbuilder/ui-ux-pro-max-skill',
    filePath: '.claude/skills/banner-design/SKILL.md',
    licence: 'MIT',
    why: 'Banner and ad-unit composition, for creatives that are not square or vertical.',
  },
  // ── The design and conversion layer ────────────────────────────────────────────────────────────────────────────
  // scroll-craft is a layout philosophy and ui-ux-pro-max is a rules table. Neither carries conversion copywriting,
  // art direction, or a critique rubric, which is why pages came out tidy and commercially empty.
  {
    slug: 'impeccable',
    name: 'impeccable',
    repo: 'pbakaus/impeccable',
    filePath: '.claude/skills/impeccable/SKILL.md',
    licence: 'Apache-2.0',
    why:
      'Design-director discipline: a visual point of view, a craft floor with explicit bans, and the instruction to ' +
      'verify by looking at the rendered result at the size it ships at.',
  },
  {
    slug: 'impeccable-critique',
    name: 'impeccable-critique',
    repo: 'pbakaus/impeccable',
    filePath: '.claude/skills/impeccable/reference/critique-rubric.md',
    licence: 'Apache-2.0',
    why:
      'The review rubric: what separates craft from slop, dimension by dimension. Used as the critique step of the ' +
      'page pipeline instead of an invented checklist.',
  },
  {
    slug: 'impeccable-craft-floor',
    name: 'impeccable-craft-floor',
    repo: 'pbakaus/impeccable',
    filePath: '.claude/skills/impeccable/reference/craft-floor.md',
    licence: 'Apache-2.0',
    why:
      'The quality floor and the absolute bans. Read before writing any UI: it names what makes output look ' +
      'machine-made, which is the failure being fixed.',
  },
  {
    slug: 'landing-copywriting',
    name: 'landing-copywriting',
    repo: 'Paldom/landing-page-builder-skills',
    filePath: 'skills/landing-page-copywriting/SKILL.md',
    licence: 'MIT',
    why: 'Conversion copy: hooks, offer framing, objection handling and CTA language, which is where generic pages fail.',
  },
  {
    slug: 'landing-structure',
    name: 'landing-structure',
    repo: 'Paldom/landing-page-builder-skills',
    filePath: 'skills/landing-page-structure/SKILL.md',
    licence: 'MIT',
    why: 'Section order and architecture that converts, so the plan is ordered by persuasion rather than habit.',
  },
  {
    slug: 'landing-art-direction',
    name: 'landing-art-direction',
    repo: 'Paldom/landing-page-builder-skills',
    filePath: 'skills/landing-page-art-direction/SKILL.md',
    licence: 'MIT',
    why: 'Art direction: the visual world, type, imagery and colour, so the page has a point of view.',
  },
  {
    slug: 'ux-guardrails',
    name: 'ux-guardrails',
    repo: 'Paldom/landing-page-builder-skills',
    filePath: 'skills/ux-guardrails/SKILL.md',
    licence: 'MIT',
    why: 'Hard UX guardrails the author must satisfy, so legibility, tap targets and motion are not left to taste.',
  },
  {
    slug: 'video-shotcraft',
    name: 'video-shotcraft',
    // The owner asked for this one by URL: HyperFrames gives motion, but the SHOT DESIGN — how a
    // product promo is actually cut, what each shot is for, beat sync and sound design — is the part
    // that was coming out basic. 124 shot recipe cards and 150 motion previews, from a 20k-star repo.
    //
    // Apache-2.0, not MIT: permissive and fine for a closed-source product *with attribution*, which
    // is what `attribution` carries and what the vendor gate enforces. Deliberately NOT the AGPL
    // OpenMontage (see docs/openmontage-decision.md) — that licence would reach our own source.
    repo: 'Vincentwei1021/video-shotcraft',
    filePath: 'SKILL.md',
    licence: 'Apache-2.0',
    why:
      'Cinematic shot design for product promos — shot recipes, beat sync, sound design and edit ' +
      'structure. Load it before designing any promo or reel; it is what stops the motion looking generic.',
  },
  // ── The ad-copy layer ───────────────────────────────────────────────────────────────────────────────────────────
  // Everything above is about how a creative LOOKS. This family is about what it SAYS, and about which creative to
  // make next: the angle, the character budget, the phrases that make copy read as generated, and the loop from
  // measured results back into new variations.
  ...adCreativeFamily(),
];

const raw = (repo, filePath) =>
  `https://raw.githubusercontent.com/${repo}/HEAD/${filePath}`;

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'nobogent-vendor-skills' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

/**
 * A one-line description for the prompt catalogue.
 *
 * Upstream frontmatter is inconsistent: some skills carry a good `description`, some carry
 * an empty string, some have none. An empty one must not be used, because it produces a
 * skill the agent can never choose — it costs a catalogue slot and says nothing. So the
 * fallback reads the body: the first real paragraph after the title, trimmed to a line.
 */
function describeSkill(meta, body, fallbackName, repo, filePath) {
  const declared = typeof meta.description === 'string' ? meta.description.trim() : '';
  if (declared.length > 20) return declared.replace(/\s+/g, ' ');

  const lines = body.split(/\r?\n/);
  const paragraph = [];
  for (const line of lines) {
    const text = line.trim();
    if (!text) {
      if (paragraph.length) break;
      continue;
    }
    if (/^#{1,6}\s/.test(text)) {
      if (paragraph.length) break;
      continue;
    }
    if (/^[-*|>]/.test(text)) continue;
    paragraph.push(text);
    if (paragraph.join(' ').length > 240) break;
  }

  const derived = paragraph.join(' ').replace(/\s+/g, ' ').trim();
  if (derived.length > 20) return derived.slice(0, 320);
  return `${fallbackName} — vendored from ${repo} (${filePath}).`;
}
function splitFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at === -1) continue;
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim().replace(/^["']|["']$/g, '');
    // An EMPTY value is the same as a missing one: upstream writes `description: ""` and
    // treating that as a real description produced a skill nobody could ever pick.
    if (key && value.length > 0) meta[key] = value;
  }
  return { meta, body: text.slice(match[0].length) };
}

/** The commit this content came from, so a refresh is traceable. */
async function headSha(repo, cache) {
  if (cache.has(repo)) return cache.get(repo);
  const response = await fetch(`https://api.github.com/repos/${repo}/commits/HEAD`, {
    headers: { 'User-Agent': 'nobogent-vendor-skills', Accept: 'application/vnd.github.sha' },
  });
  const sha = response.ok ? String(await response.text()).trim().slice(0, 40) : 'unknown';
  cache.set(repo, sha);
  return sha;
}

const checkOnly = process.argv.includes('--check');

/**
 * `--only=<slug,slug>` restricts the run to those slugs.
 *
 * Adding one skill must not quietly rewrite the others: several repos we vendor from have moved
 * since we last refreshed them, and adopting upstream's newer text is a separate decision with its
 * own review. Without this flag, vendoring a new skill drags every stale sibling into the same diff
 * and the reviewer cannot tell which change was intended.
 */
const onlyArg = process.argv.find((arg) => arg.startsWith('--only'));
const onlySlugs = onlyArg
  ? new Set(
      (onlyArg.includes('=') ? onlyArg.slice(onlyArg.indexOf('=') + 1) : '')
        .split(',')
        .map((slug) => slug.trim())
        .filter(Boolean),
    )
  : null;

const shas = new Map();
const written = [];
const drifted = [];

for (const source of SOURCES) {
  if (onlySlugs && !onlySlugs.has(source.slug)) continue;
  const url = raw(source.repo, source.filePath);
  let text;
  try {
    text = await fetchText(url);
  } catch (error) {
    console.error(`  FAIL ${source.slug}: ${String(error.message ?? error)}`);
    process.exitCode = 1;
    continue;
  }

  const { meta, body } = splitFrontmatter(text);
  const sha = await headSha(source.repo, shas);
  const description = describeSkill(meta, body, source.name, source.repo, source.filePath);

  const attribution = `{
    repo: ${JSON.stringify(source.repo)},
    path: ${JSON.stringify(source.filePath)},
    commit: ${JSON.stringify(sha)},
    licence: ${JSON.stringify(source.licence)},
    url: ${JSON.stringify(`https://github.com/${source.repo}/blob/${sha === 'unknown' ? 'HEAD' : sha}/${source.filePath}`)},
  }`;

  // A reference is a companion document, not a skill: it is loaded by `get_skill_reference` and never takes a
  // catalogue slot, so it is emitted in a different shape rather than being smuggled in as a bad skill.
  const emitted = source.kind === 'reference'
    ? `export const reference = {
  name: ${JSON.stringify(source.name)},
  /** Human title, ours — the upstream file has no frontmatter to read one from. */
  title: ${JSON.stringify(source.title)},
  /** The skill this document belongs to, so the loader can list a skill's companions. */
  belongsTo: ${JSON.stringify(source.belongsTo)},
  description: ${JSON.stringify(String(description).replace(/\s+/g, ' ').slice(0, 400))},
  content: ${JSON.stringify(body.trimStart())},
  attribution: ${attribution},
} as const;`
    : `export const skill = {
  name: ${JSON.stringify(source.name)},
  description: ${JSON.stringify(String(description).replace(/\s+/g, ' ').slice(0, 400))},
  content: ${JSON.stringify(body.trimStart())},
  /**
   * What WE use it for. The router can only see text, and upstream descriptions are written
   * for a human browsing a repo — scroll-craft's never says "landing page", so it was
   * invisible to routing for exactly the task it is best at. This line is ours, it is
   * honest about our purpose, and it is what makes the skill findable.
   */
  useFor: ${JSON.stringify(source.why)},
  attribution: ${attribution},
} as const;`;

  const module = `/**
 * VENDORED ${source.kind === 'reference' ? 'REFERENCE' : 'SKILL'} — do not hand-edit. Refresh with \`node scripts/vendor-skills.mjs\`.
 *
 *   upstream : ${source.repo}
 *   path     : ${source.filePath}
 *   commit   : ${sha}
 *   licence  : ${source.licence}
 *
 * ${source.why}
 *
 * The licence permits commercial use with attribution, which is what \`attribution\`
 * carries and what the gate checks. If upstream changes its licence, refresh this file
 * and update the constant — do not strip the attribution to make a test pass.
 */
${emitted}
`;

  const target = path.join(OUT_DIR, `${source.slug}.ts`);
  const previous = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  const changed = previous !== module;

  if (checkOnly) {
    if (!previous) drifted.push(`${source.slug} (missing locally)`);
    else if (changed) drifted.push(`${source.slug} (differs from upstream)`);
    console.log(`  ${changed ? 'DRIFT' : 'same '} ${source.slug}  ${sha.slice(0, 8)}  ${(body.length / 1024).toFixed(1)} KB`);
    continue;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(target, module, 'utf8');
  written.push(source.slug);
  console.log(`  ok    ${source.slug}  ${sha.slice(0, 8)}  ${(body.length / 1024).toFixed(1)} KB`);
}

if (checkOnly) {
  console.log(drifted.length ? `\n${drifted.length} skill(s) drifted: ${drifted.join(', ')}` : '\nall vendored skills match upstream');
  if (drifted.length) process.exitCode = 1;
} else {
  console.log(`\nwrote ${written.length} skill(s) to ${OUT_DIR}`);
}
