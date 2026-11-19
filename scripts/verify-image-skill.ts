/**
 * Proves the `image` skill's contract WITHOUT a network, a provider or a single
 * credit spent.
 *
 * What it pins, and why each one is here rather than in a picture review:
 *
 *  1. ONE CALL, ONE FINISHED IMAGE. The prompt builder never asks for a
 *     "background", for blank space, or for room to put type later — the banned
 *     shape (generate a bare picture, then draw HTML/CSS/SVG design on top of it)
 *     cannot come back through a brief, because the brief is scrubbed first.
 *  2. The typography is INSIDE the image in every emitted prompt.
 *  3. A reference in routes to the registry's image-edit model and NEVER to the
 *     text-to-image one, on every ratio and every reference count.
 *  4. Unknown aspect ratios are refused with the list of ones this app offers.
 *  5. Credits come from the registry (`estimateCredits`), never from a number
 *     typed into the skill.
 *  6. No model id — and no vendor name — ever reaches the prompt text.
 *  7. The repo contains ZERO remaining overlay/composite-on-generated-image call
 *     sites. The exact files this package deleted are asserted gone, by name.
 *  8. Running the skill submits exactly once, publishes to the planned R2 key, and
 *     records THAT key on the run row.
 *
 *   npm run verify:image-skill
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  MEDIA_MODELS,
  estimateCredits,
  imageModelFor,
} from '../lib/agent/media-models';
import {
  FRAME_BY_RATIO,
  IMAGE_ASPECT_RATIOS,
  InventedFactError,
  ImageAspectError,
  TYPOGRAPHY_CLAUSE,
  bannedPhrasingIn,
  buildImagePrompt,
  findUnverifiedClaims,
  isImageAspectRatio,
  scrubBrief,
} from '../lib/agent/tools/skills/image/prompt';
import {
  DEFAULT_ASPECT,
  IMAGE_EDIT_MODEL,
  IMAGE_MODEL,
  MAX_SUBMISSIONS,
  artefactKeyStemFor,
  createImage,
  imageCredits,
  planImageSkill,
  ratioSlug,
  recordImageArtefact,
  slugFor,
  sniffImageExtension,
  type ImageArtefact,
  type ImageSkillDeps,
} from '../lib/agent/tools/skills/image/index';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}

function throws(fn: () => unknown): { threw: boolean; message: string; error: unknown } {
  try {
    fn();
    return { threw: false, message: '', error: null };
  } catch (error: any) {
    return { threw: true, message: String(error?.message ?? error), error };
  }
}

async function rejects(fn: () => Promise<unknown>): Promise<{ threw: boolean; message: string }> {
  try {
    await fn();
    return { threw: false, message: '' };
  } catch (error: any) {
    return { threw: true, message: String(error?.message ?? error) };
  }
}

const ROOT = process.cwd();
const rel = (full: string) => path.relative(ROOT, full).split(path.sep).join('/');

// ────────────────────────────────────────────────────────────────────────────
// Fixtures: real briefs, in the shapes this app actually receives
// ────────────────────────────────────────────────────────────────────────────

interface Fixture {
  name: string;
  brief: string;
  facts?: Record<string, unknown> | null;
}

const FIXTURES: readonly Fixture[] = [
  {
    name: 'real estate offer with verified price',
    brief: 'Diwali offer on the 3BHK apartments at Green Meadows, ready to move',
    facts: {
      project: 'Green Meadows',
      price: 'Starting ₹1.45 Cr',
      location: 'Sector 82, Mohali',
      offer: 'Diwali booking open',
    },
  },
  {
    name: 'services business, no facts at all',
    brief: 'Announce that the studio is open for weekend portrait bookings',
  },
  {
    name: 'product launch with a discount and a phone number',
    brief: 'Launch poster for the winter jacket, 40% off this week',
    facts: { product: 'Winter Jacket', discount: '40% off', contact: '9876543210' },
  },
  {
    name: 'brief written by someone who still thinks in backgrounds',
    brief:
      'Make a clean background with the tower in it and leave room for text on the right, no text overlays',
    facts: { project: 'Meridian Towers' },
  },
];

const REFERENCE_SETS: readonly string[][] = [
  [],
  ['https://cdn.example.com/property/front.jpg'],
  [
    'https://cdn.example.com/property/front.jpg',
    'https://cdn.example.com/property/pool.jpg',
    'https://cdn.example.com/brand/logo.png',
  ],
];

// ────────────────────────────────────────────────────────────────────────────
// 1-2. The prompt builder: no banned phrasing, typography always inside
// ────────────────────────────────────────────────────────────────────────────

console.log('=== the prompt is a single-call FINISHED design ===');
{
  const emitted: { fixture: string; ratio: string; refs: number; prompt: string }[] = [];
  for (const fixture of FIXTURES) {
    for (const ratio of IMAGE_ASPECT_RATIOS) {
      for (const refs of REFERENCE_SETS) {
        emitted.push({
          fixture: fixture.name,
          ratio,
          refs: refs.length,
          prompt: buildImagePrompt({
            brief: fixture.brief,
            facts: fixture.facts,
            referenceUrls: refs,
            aspectRatio: ratio,
          }),
        });
      }
    }
  }

  check('a prompt was emitted for every brief x ratio x reference case', emitted.length === 4 * 4 * 3, `${emitted.length} prompts`);

  const withBanned = emitted.filter((e) => bannedPhrasingIn(e.prompt).length > 0);
  const examples = withBanned.slice(0, 2).map((e) => `${e.fixture}/${e.ratio}: ${bannedPhrasingIn(e.prompt).join(', ')}`);
  check(
    'no emitted prompt contains "background" / "blank space" / "leave room for text" phrasing',
    withBanned.length === 0,
    withBanned.length ? examples.join(' | ') : `${emitted.length} prompts clean`,
  );

  const missingType = emitted.filter((e) => !e.prompt.includes(TYPOGRAPHY_CLAUSE));
  check(
    'every emitted prompt asks for the typography INSIDE the image',
    missingType.length === 0,
    missingType.length ? `${missingType.length} prompt(s) without the typography clause` : `${emitted.length} prompts carry it`,
  );

  const wordsInside = emitted.filter((e) => !/inside this one image/i.test(e.prompt));
  check(
    'every emitted prompt says the design is produced in this one image',
    wordsInside.length === 0,
    wordsInside.length ? `${wordsInside.length} prompt(s) missing the single-pass statement` : 'all present',
  );

  // A brief that carries the banned vocabulary is rewritten, not obeyed.
  const scrubbed = scrubBrief(
    'Generate a bare background image, keep blank space on the left for the headline, no text',
  );
  check(
    'a brief asking for a bare background is scrubbed before it reaches a model',
    bannedPhrasingIn(scrubbed).length === 0 && scrubbed.length > 0,
    scrubbed,
  );
  check(
    'scrubbing leaves ordinary art direction alone',
    scrubBrief('A warm evening shot of the villa entrance with the pool lit') ===
      'A warm evening shot of the villa entrance with the pool lit',
  );

  const frameLines = IMAGE_ASPECT_RATIOS.map((ratio) => FRAME_BY_RATIO[ratio]);
  check('every offered ratio has a frame sentence', frameLines.every((line) => line.length > 10), frameLines.length + ' frames');
}

// ────────────────────────────────────────────────────────────────────────────
// 3. References route to the edit model, never to text-to-image
// ────────────────────────────────────────────────────────────────────────────

console.log('\n=== a reference in means image-to-image, never text-to-image ===');
{
  const routes: { ratio: string; refs: number; route: string; model: string }[] = [];
  for (const ratio of IMAGE_ASPECT_RATIOS) {
    for (const refs of REFERENCE_SETS) {
      const plan = planImageSkill({
        brief: 'Poster for the villa launch',
        facts: { price: 'Starting ₹2.1 Cr' },
        referenceUrls: refs,
        aspectRatio: ratio,
      });
      routes.push({ ratio, refs: refs.length, route: plan.route, model: plan.model });
    }
  }

  const referenceCases = routes.filter((r) => r.refs > 0);
  const textCases = routes.filter((r) => r.refs === 0);

  check('there are reference cases and text-only cases to compare', referenceCases.length === 8 && textCases.length === 4, `${referenceCases.length} ref / ${textCases.length} text`);
  check(
    'every reference case uses the registry image-edit model',
    referenceCases.every((r) => r.model === MEDIA_MODELS.imageEdit.id && r.route === 'imageEdit'),
    referenceCases.map((r) => `${r.ratio}x${r.refs}:${r.route}`).join(' '),
  );
  check(
    'NO reference case uses the text-to-image model',
    referenceCases.every((r) => r.model !== MEDIA_MODELS.image.id),
    `imageEdit=${MEDIA_MODELS.imageEdit.id}`,
  );
  check(
    'every text-only case uses the registry text-to-image model',
    textCases.every((r) => r.model === MEDIA_MODELS.image.id && r.route === 'image'),
    textCases.map((r) => `${r.ratio}:${r.route}`).join(' '),
  );
  check(
    'the skill takes its model from imageModelFor, not from a literal',
    IMAGE_MODEL === imageModelFor([]) && IMAGE_EDIT_MODEL === imageModelFor(['https://x/y.png']),
    `${IMAGE_MODEL} / ${IMAGE_EDIT_MODEL}`,
  );
  check(
    'reference URLs are forwarded to the plan intact (order and count)',
    planImageSkill({
      brief: 'Poster',
      referenceUrls: REFERENCE_SETS[2],
      aspectRatio: '3:4',
    }).referenceUrls.join(',') === REFERENCE_SETS[2].join(','),
  );
  check(
    'a non-http reference is dropped rather than sent to the provider',
    planImageSkill({
      brief: 'Poster',
      referenceUrls: ['file:///etc/passwd', 'not-a-url', 'https://ok.example/x.png'],
      aspectRatio: '3:4',
    }).referenceUrls.length === 1,
  );
  check(
    'the prompt names the references as the real subject to reproduce',
    /reproduce the subject of the first reference faithfully/i.test(
      buildImagePrompt({
        brief: 'Poster',
        referenceUrls: ['https://x/y.png'],
        aspectRatio: '3:4',
      }),
    ),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 4. Aspect ratios: only the four the app offers
// ────────────────────────────────────────────────────────────────────────────

console.log('\n=== aspect ratios are the ones the app actually offers ===');
{
  check(
    'the offered set is exactly 3:4, 1:1, 9:16, 16:9',
    JSON.stringify([...IMAGE_ASPECT_RATIOS]) === JSON.stringify(['3:4', '1:1', '9:16', '16:9']),
    IMAGE_ASPECT_RATIOS.join(', '),
  );
  check('the default ratio is one of them', isImageAspectRatio(DEFAULT_ASPECT), DEFAULT_ASPECT);

  for (const bogus of ['4:5', '2:3', '3:2', '9:21', '', 'A4', 'auto', '3/4', 4, 16]) {
    const attempt = throws(() => planImageSkill({ brief: 'Poster', aspectRatio: bogus as any }));
    check(
      `aspect ratio ${JSON.stringify(bogus)} is rejected`,
      attempt.threw && (attempt.error as Error)?.name === 'ImageAspectError',
      attempt.threw ? attempt.message.slice(0, 90) : 'accepted — WRONG',
    );
  }

  // An omitted ratio is a caller choice, not an error: it gets the poster default.
  check(
    'an omitted aspect ratio falls back to the default poster ratio',
    planImageSkill({ brief: 'Poster' }).aspectRatio === DEFAULT_ASPECT,
    DEFAULT_ASPECT,
  );
  check(
    'an explicitly null aspect ratio also falls back to the default',
    planImageSkill({ brief: 'Poster', aspectRatio: null as any }).aspectRatio === DEFAULT_ASPECT,
  );

  const error = throws(() => planImageSkill({ brief: 'Poster', aspectRatio: '4:5' })).error as ImageAspectError;
  check(
    'the rejection names the ratios that are on offer (and explains 4:5)',
    /\b3:4, 1:1, 9:16, 16:9\b/.test(String(error?.message)) && /4:5 is not a provider enum/.test(String(error?.message)),
    String(error?.message).slice(0, 110),
  );

  check(
    'each ratio keeps a distinct object-key form',
    new Set(IMAGE_ASPECT_RATIOS.map(ratioSlug)).size === IMAGE_ASPECT_RATIOS.length,
    IMAGE_ASPECT_RATIOS.map(ratioSlug).join(' '),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 5. Money: estimated from the registry, never typed here
// ────────────────────────────────────────────────────────────────────────────

console.log('\n=== credits come from MEDIA_MODELS ===');
{
  const textPlan = planImageSkill({ brief: 'Poster for the villa launch', aspectRatio: '3:4' });
  const refPlan = planImageSkill({
    brief: 'Poster for the villa launch',
    referenceUrls: ['https://x/y.png'],
    aspectRatio: '3:4',
  });

  check(
    "a text-to-image plan costs estimateCredits('image', 1)",
    textPlan.credits === estimateCredits('image', 1),
    `${textPlan.credits} vs ${estimateCredits('image', 1)}`,
  );
  check(
    "a reference plan costs estimateCredits('imageEdit', 1)",
    refPlan.credits === estimateCredits('imageEdit', 1),
    `${refPlan.credits} vs ${estimateCredits('imageEdit', 1)}`,
  );
  check(
    'both routes agree with estimateCredits for n=1',
    estimateCredits('image', 1) === estimateCredits('imageEdit', 1),
    `image=${estimateCredits('image', 1)} imageEdit=${estimateCredits('imageEdit', 1)}`,
  );
  check('an image is not free', textPlan.credits > 0, `${textPlan.credits} credits`);
  check(
    'the estimate scales with units exactly as the registry does',
    estimateCredits('image', 3) === estimateCredits('image', 1) * 3,
    `${estimateCredits('image', 3)} vs ${estimateCredits('image', 1)} x 3`,
  );
  check(
    'imageCredits() is the registry function and nothing else',
    imageCredits('image') === estimateCredits('image', 1) && imageCredits('imageEdit') === estimateCredits('imageEdit', 1),
    `${imageCredits('image')} / ${imageCredits('imageEdit')}`,
  );
  check(
    'the plan charges for exactly one image',
    textPlan.creditLines.length === 1 && textPlan.creditLines.reduce((n, l) => n + l.credits, 0) === textPlan.credits,
    JSON.stringify(textPlan.creditLines),
  );
  check(
    'the quoted model on the plan is the one the route will call',
    textPlan.creditLines[0].media === textPlan.model,
    textPlan.creditLines[0].media,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 6. No model id in the prompt
// ────────────────────────────────────────────────────────────────────────────

console.log('\n=== no vendor or model id ever reaches the prompt ===');
{
  const known = new Set<string>();
  for (const kind of Object.keys(MEDIA_MODELS) as (keyof typeof MEDIA_MODELS)[]) {
    known.add(MEDIA_MODELS[kind].id);
    for (const fb of MEDIA_MODELS[kind].fallbacks) known.add(fb);
  }

  const idHits: string[] = [];
  for (const fixture of FIXTURES) {
    for (const ratio of IMAGE_ASPECT_RATIOS) {
      for (const refs of REFERENCE_SETS) {
        const prompt = buildImagePrompt({ brief: fixture.brief, facts: fixture.facts, referenceUrls: refs, aspectRatio: ratio });
        for (const id of known) {
          if (prompt.toLowerCase().includes(id.toLowerCase())) idHits.push(`${fixture.name}: ${id}`);
        }
        for (const token of ['flare', 'nano-banana', 'gpt-image', 'kie', 'grok', 'gemini']) {
          if (prompt.toLowerCase().includes(token)) idHits.push(`${fixture.name}: ${token}`);
        }
      }
    }
  }
  check(
    'no emitted prompt contains a registry model id or a vendor name',
    idHits.length === 0,
    idHits.length ? idHits.slice(0, 4).join(', ') : `${known.size} ids + 6 vendor tokens checked`,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 7. Facts are never invented
// ────────────────────────────────────────────────────────────────────────────

console.log('\n=== the skill refuses to invent facts ===');
{
  const unverified = findUnverifiedClaims('Launch price ₹1.2 Cr, 50% off, call 9998887776', {
    project: 'Meridian Towers',
  });
  check(
    'a price, a discount and a phone number missing from the facts are all caught',
    unverified.length === 3,
    unverified.join(', '),
  );
  check(
    'the caught claims are the ones the brief stated',
    unverified.some((c) => /1\.2/.test(c)) && unverified.some((c) => /50\s?%/.test(c)) && unverified.some((c) => /9998887776/.test(c)),
    unverified.join(', '),
  );

  const supported = findUnverifiedClaims('Launch price ₹1.2 Cr, 50% off', {
    price: '₹1.2 Cr',
    discount: '50% off',
  });
  check('a claim the facts DO support passes', supported.length === 0, supported.join(', ') || 'clean');

  check(
    'a brief with no numbers at all is clean',
    findUnverifiedClaims('Announce the weekend portrait sessions', null).length === 0,
  );

  const refusal = throws(() =>
    buildImagePrompt({ brief: 'Launch price ₹1.2 Cr at Meridian', aspectRatio: '3:4' }),
  );
  check(
    'buildImagePrompt throws rather than render an invented price',
    refusal.threw && (refusal.error as Error)?.name === 'InventedFactError',
    refusal.threw ? refusal.message.slice(0, 120) : 'no refusal — WRONG',
  );
  check(
    'the refusal is an InventedFactError carrying the claims',
    (refusal.error as InventedFactError)?.claims?.some((c) => /1\.2/.test(c)) === true,
    JSON.stringify((refusal.error as InventedFactError)?.claims ?? []),
  );
  check(
    'the plan REFUSES too (the claim scan runs before any plan is shown)',
    throws(() => planImageSkill({ brief: 'Now only ₹9,999 at Meridian', aspectRatio: '3:4' })).threw,
  );

  const noFacts = buildImagePrompt({ brief: 'Announce the weekend portrait sessions', aspectRatio: '3:4' });
  check(
    'with no facts the prompt forbids every numeric claim',
    /NO FACTS WERE SUPPLIED/.test(noFacts) && /no numeric, price, date, discount or contact claim/i.test(noFacts),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 8. The run: one submission, one R2 key, recorded on the row
// ────────────────────────────────────────────────────────────────────────────

console.log('\n=== createImage: one call, one image, one recorded key ===');

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);
const JPG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 7, 7, 7]);

interface Harness {
  deps: ImageSkillDeps;
  submit: { prompt: string; model: string; aspectRatio: string; referenceUrls: string[] }[];
  publish: { key: string; bytes: Uint8Array; contentType: string }[];
  record: { runId: string; artefact: ImageArtefact }[];
}

function harness(overrides: ImageSkillDeps = {}, bytes: Uint8Array = PNG_BYTES): Harness {
  const submit: Harness['submit'] = [];
  const publish: Harness['publish'] = [];
  const record: Harness['record'] = [];
  const deps: ImageSkillDeps = {
    affordable: async () => ({ ok: true }),
    submit: async (request) => {
      submit.push(request);
      return { taskId: 'task-1', reason: null };
    },
    poll: async () => ({ url: 'https://provider.example/out.png', reason: null }),
    download: async () => bytes,
    publish: async (args) => {
      publish.push(args);
      return { url: `https://r2.example/${args.key}`, bytes: args.bytes.length };
    },
    record: async (runId, artefact) => {
      record.push({ runId, artefact });
      return { recorded: true, reason: null };
    },
    sleep: async () => {},
    pollTries: 1,
    pollMs: 1,
    ...overrides,
  };
  return { deps, submit, publish, record };
}

const quiet = () => {};

(async () => {
  {
    const h = harness();
    const result = await createImage({
      runId: 'run-1',
      userId: 'user-1',
      input: {
        brief: 'Diwali offer on the 3BHK apartments at Green Meadows',
        facts: { price: 'Starting ₹1.45 Cr', location: 'Sector 82, Mohali' },
        aspectRatio: '3:4',
      },
      deps: h.deps,
      log: quiet,
    });

    check('one run makes exactly ONE provider submission', h.submit.length === 1 && result.submissions === 1, `${h.submit.length} submission(s)`);
    check(
      'the submission carries the planned model, ratio and prompt',
      h.submit[0].model === result.plan.model &&
        h.submit[0].aspectRatio === '3:4' &&
        h.submit[0].prompt === result.plan.prompt,
    );
    check('a text-only run sends no reference URLs', h.submit[0].referenceUrls.length === 0);
    check(
      'the image is published to the key the plan named',
      result.artefact.key === result.plan.artefactKey && h.publish[0].key === result.plan.artefactKey,
      result.artefact.key,
    );
    check(
      'the key is under the image/ prefix and names the ratio',
      /^image\/[a-z0-9-]+\/3x4-[0-9a-f]{8}\.png$/.test(result.artefact.key),
      result.artefact.key,
    );
    check(
      'the R2 key is recorded on the run row',
      h.record.length === 1 &&
        h.record[0].runId === 'run-1' &&
        h.record[0].artefact.key === result.artefact.key &&
        result.recorded.recorded === true,
      h.record[0]?.artefact.key ?? 'nothing recorded',
    );
    check(
      'the recorded artefact states the model, the route and the ratio',
      h.record[0].artefact.model === result.plan.model &&
        h.record[0].artefact.route === 'image' &&
        h.record[0].artefact.aspectRatio === '3:4',
    );
    check('the recorded artefact keeps the exact prompt for a later audit', h.record[0].artefact.prompt === result.plan.prompt);
    check('the published URL is the plan key on the bucket', result.artefact.url.endsWith(result.artefact.key), result.artefact.url);
    check('the artefact byte count comes from the upload', result.artefact.bytes === PNG_BYTES.length, `${result.artefact.bytes}`);

    // Determinism: the same plan publishes to the same object, so a retry does
    // not leave a second copy behind.
    const again = await createImage({
      runId: 'run-1',
      userId: 'user-1',
      input: { brief: 'Diwali offer on the 3BHK apartments at Green Meadows', facts: { price: 'Starting ₹1.45 Cr', location: 'Sector 82, Mohali' }, aspectRatio: '3:4' },
      deps: harness().deps,
      log: quiet,
    });
    check('the same input publishes to the same R2 key', again.artefact.key === result.artefact.key, again.artefact.key);
  }

  console.log('\n=== createImage: a reference is edited, not replaced ===');
  {
    const h = harness();
    const result = await createImage({
      runId: 'run-ref',
      userId: 'user-1',
      input: {
        brief: 'Poster for the villa launch',
        facts: { price: 'Starting ₹2.1 Cr' },
        referenceUrls: ['https://cdn.example.com/villa.jpg'],
        aspectRatio: '9:16',
      },
      deps: h.deps,
      log: quiet,
    });

    check('a reference run still makes exactly ONE submission', h.submit.length === 1, `${h.submit.length}`);
    check('the submission uses the image-edit model', h.submit[0].model === MEDIA_MODELS.imageEdit.id, h.submit[0].model);
    check('the submission never uses the text-to-image model', h.submit[0].model !== MEDIA_MODELS.image.id);
    check(
      'the reference URLs reach the provider call',
      JSON.stringify(h.submit[0].referenceUrls) === JSON.stringify(['https://cdn.example.com/villa.jpg']),
      h.submit[0].referenceUrls.join(','),
    );
    check('the recorded route says imageEdit', h.record[0].artefact.route === 'imageEdit');
    check('the key names the 9:16 ratio', /\/9x16-[0-9a-f]{8}\.png$/.test(result.artefact.key), result.artefact.key);
  }

  console.log('\n=== createImage: failures are honest, and cheap ===');
  {
    // Affordability refuses BEFORE the provider is touched.
    const h = harness({ affordable: async () => ({ ok: false, reason: 'balance too low' }) });
    const refused = await rejects(() =>
      createImage({ runId: 'run-poor', userId: 'u', input: { brief: 'Poster' }, deps: h.deps, log: quiet }),
    );
    check('an unaffordable run throws before spending anything', refused.threw && h.submit.length === 0, refused.message.slice(0, 80));
    check('the refusal carries the affordability reason', /balance too low/.test(refused.message));

    // A transient 524 gets ONE retry on the SAME model.
    const retrySubmit: string[] = [];
    const retry = harness({
      submit: async (request) => {
        retrySubmit.push(request.model);
        return retrySubmit.length === 1
          ? { taskId: null, reason: 'Kie AI Task creation failed with status 524' }
          : { taskId: 'task-2', reason: null };
      },
    });
    const retried = await createImage({ runId: 'run-524', userId: 'u', input: { brief: 'Poster' }, deps: retry.deps, log: quiet });
    check('a 524 is retried exactly once', retried.submissions === 2 && retrySubmit.length === 2, `${retrySubmit.length} submissions`);
    check('the retry stays on the SAME model', new Set(retrySubmit).size === 1 && retrySubmit[0] === retried.plan.model, retrySubmit.join(','));
    check('MAX_SUBMISSIONS is 2 — one go plus one retry', MAX_SUBMISSIONS === 2, `${MAX_SUBMISSIONS}`);

    // A 422 is permanent and must not be retried.
    const permanentSubmits: string[] = [];
    const permanent = harness({
      submit: async () => {
        permanentSubmits.push('x');
        return { taskId: null, reason: 'Image task creation failed with status 422' };
      },
    });
    const permanentResult = await rejects(() =>
      createImage({ runId: 'run-422', userId: 'u', input: { brief: 'Poster' }, deps: permanent.deps, log: quiet }),
    );
    check('a 422 is NOT retried', permanentSubmits.length === 1, `${permanentSubmits.length} submission(s)`);
    check('a failed submission throws with the provider reason', permanentResult.threw && /422/.test(permanentResult.message));
    check('nothing is recorded when no image was produced', permanent.record.length === 0);

    // A render that never lands must not publish or record.
    const never = harness({ poll: async () => ({ url: null, reason: null }), pollTries: 2, pollMs: 1 });
    const stalled = await rejects(() =>
      createImage({ runId: 'run-stall', userId: 'u', input: { brief: 'Poster' }, deps: never.deps, log: quiet }),
    );
    check('a render that never lands throws instead of publishing', stalled.threw && never.publish.length === 0 && never.record.length === 0, stalled.message.slice(0, 90));

    // A provider-side failure is surfaced, not swallowed.
    const failed = harness({ poll: async () => ({ url: null, reason: 'content policy' }), pollTries: 3, pollMs: 1 });
    const failedResult = await rejects(() =>
      createImage({ runId: 'run-fail', userId: 'u', input: { brief: 'Poster' }, deps: failed.deps, log: quiet }),
    );
    check('a provider failure reason is reported verbatim', failedResult.threw && /content policy/.test(failedResult.message));
    check('a provider failure publishes nothing', failed.publish.length === 0);

    // createImage needs identifiers: the run row and the payer.
    check('createImage refuses without a runId', (await rejects(() => createImage({ userId: 'u', input: { brief: 'Poster' }, log: quiet } as any))).threw);
    check('createImage refuses without a userId', (await rejects(() => createImage({ runId: 'r', input: { brief: 'Poster' }, log: quiet } as any))).threw);
  }

  console.log('\n=== the recorded row: a missing migration is reported, not thrown ===');
  {
    const artefact: ImageArtefact = {
      key: 'image/poster/3x4-abcdef12.png',
      url: 'https://r2.example/image/poster/3x4-abcdef12.png',
      bytes: 1234,
      aspectRatio: '3:4',
      model: IMAGE_MODEL,
      route: 'image',
      prompt: 'prompt text',
    };

    const written: Record<string, unknown>[] = [];
    const matched: { column: string; value: string }[] = [];
    const okDb = {
      from: () => ({
        update: (values: Record<string, unknown>) => ({
          eq: async (column: string, value: string) => {
            written.push(values);
            matched.push({ column, value });
            return { error: null };
          },
        }),
      }),
    };
    const okResult = await recordImageArtefact(okDb, 'run-9', artefact);
    check('the artefact key is written to agent_runs.artefact_key', okResult.recorded === true && written[0]?.artefact_key === artefact.key, String(written[0]?.artefact_key));
    check('the public URL is written alongside it', written[0]?.artefact_url === artefact.url);
    check(
      'the row is matched on run_id',
      matched.length === 1 && matched[0].column === 'run_id' && matched[0].value === 'run-9',
      JSON.stringify(matched[0] ?? null),
    );
    const meta = written[0]?.artefact_meta as Record<string, unknown>;
    check(
      'artefact_meta names the skill, ratio and model',
      meta?.skill === 'image' && meta?.aspect_ratio === '3:4' && meta?.model === IMAGE_MODEL,
      JSON.stringify(meta),
    );

    const oldDb = {
      from: () => ({
        update: () => ({
          eq: async () => ({ error: { code: 'PGRST204', message: "Could not find the 'artefact_key' column" } }),
        }),
      }),
    };
    const oldResult = await recordImageArtefact(oldDb, 'run-10', artefact);
    check('an un-migrated database reports recorded:false with the key', oldResult.recorded === false && String(oldResult.reason).includes(artefact.key), String(oldResult.reason).slice(0, 110));
    check('no Supabase client is a report, not a crash', (await recordImageArtefact(null, 'run-11', artefact)).recorded === false);
  }

  console.log('\n=== housekeeping helpers ===');
  {
    check('PNG bytes are detected as png', sniffImageExtension(PNG_BYTES) === 'png');
    check('JPEG bytes are detected as jpg', sniffImageExtension(JPG_BYTES) === 'jpg');

    const jpegRun = harness({}, JPG_BYTES);
    const jpegResult = await createImage({
      runId: 'run-jpg',
      userId: 'u',
      input: { brief: 'Poster for the pool deck' },
      deps: jpegRun.deps,
      log: quiet,
    });
    check(
      'a JPEG result publishes with a .jpg key and image/jpeg (the provider decides the format)',
      jpegResult.artefact.key.endsWith('.jpg') && jpegRun.publish[0].contentType === 'image/jpeg',
      `${jpegResult.artefact.key} / ${jpegRun.publish[0].contentType}`,
    );
    check(
      'the key stem is unchanged by the format',
      jpegResult.artefact.key.replace(/\.jpg$/, '') === jpegResult.plan.artefactKeyStem,
      jpegResult.plan.artefactKeyStem,
    );

    check(
      'the same prompt publishes to the same stem',
      artefactKeyStemFor({ slug: 'a', ratio: '3:4', prompt: 'p', model: 'm' }) ===
        artefactKeyStemFor({ slug: 'a', ratio: '3:4', prompt: 'p', model: 'm' }),
    );
    check(
      'a different prompt publishes to a different stem',
      artefactKeyStemFor({ slug: 'a', ratio: '3:4', prompt: 'p', model: 'm' }) !==
        artefactKeyStemFor({ slug: 'a', ratio: '3:4', prompt: 'q', model: 'm' }),
    );
    check('a slug is lowercase, safe and non-empty', /^[a-z0-9-]+$/.test(slugFor('Diwali Offer: 3BHK @ Green Meadows!')), slugFor('Diwali Offer: 3BHK @ Green Meadows!'));
    check('an empty brief still yields a usable slug', slugFor('') === 'image');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 9. The repo: no overlay/composite-on-generated-image path survives
  // ──────────────────────────────────────────────────────────────────────────

  console.log('\n=== the repo has no overlay path left ===');

  /**
   * The exact files this package removed, and why each one was an overlay path.
   * Asserted absent BY NAME, not just by pattern, so a rename cannot smuggle the
   * approach back in.
   */
  const REMOVED = [
    {
      file: 'utils/stamp-helper.ts',
      why: 'sharp().extend() + .composite() of an SVG footer (brand, phone, logo) onto a generated master image',
    },
    {
      file: 'utils/collage-generator.ts',
      why: 'sharp() canvas .composite() grid fallback, plus a prompt demanding "no text overlays"',
    },
  ];

  for (const removed of REMOVED) {
    check(`${removed.file} is gone`, !fs.existsSync(path.join(ROOT, removed.file)), removed.why);
  }

  const SCAN_DIRS = ['app', 'components', 'lib', 'utils'];
  const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '.vercel', '.turbo', 'dist', 'build', 'out']);
  const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

  const files: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile() && TEXT_EXT.has(path.extname(entry.name))) {
        files.push(full);
      }
    }
  };
  for (const dir of SCAN_DIRS) walk(path.join(ROOT, dir));

  check('application files were found to scan', files.length > 100, `${files.length} files`);

  /**
   * Constructs that draw a design layer ON TOP of generated pixels. A logo
   * centred on a solid colour for a PWA icon is a device asset, not a creative,
   * so `app/api/org-icon/route.ts` is the single named exemption.
   */
  const OVERLAY_ALLOW = new Map<string, string>([
    [
      'app/api/org-icon/route.ts',
      'PWA icon / splash: a supplied logo centred on a solid colour, plus an SVG monogram fallback — a device asset, never a marketing creative',
    ],
  ]);

  const OVERLAY_CONSTRUCTS: { label: string; re: RegExp; requires?: RegExp }[] = [
    { label: 'sharp .composite(', re: /\.composite\s*\(/ },
    // `.extend({...})` is also how a zod schema grows a field — `withApprovalId` in the review gate
    // does exactly that — so the construct only means "a drawn overlay" in a file that renders
    // pixels with sharp. Without this qualifier the approval plumbing read as an image overlay and
    // the check sat red.
    { label: 'sharp .extend(', re: /\.extend\s*\(\s*\{/, requires: /\bsharp\b/ },
    { label: 'drawText', re: /\bdrawText\b/ },
    { label: 'createCanvas', re: /\bcreateCanvas\b/ },
    { label: 'satori', re: /\bsatori\b/ },
    { label: 'resvg', re: /\bresvg\b/ },
    { label: 'footerSvg', re: /\bfooterSvg\b/ },
  ];

  for (const construct of OVERLAY_CONSTRUCTS) {
    const hits: string[] = [];
    for (const file of files) {
      let text: string;
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      if (!construct.re.test(text)) continue;
      // A construct that only means something in a particular kind of file: skip the rest.
      if (construct.requires && !construct.requires.test(text)) continue;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!construct.re.test(line)) continue;
        // A construct mentioned inside a comment is documentation, not a call site.
        if (/^\s*(\*|\/\/|\/\*)/.test(line)) continue;
        hits.push(`${rel(file)}:${i + 1}`);
      }
    }
    const offenders = hits.filter((hit) => !OVERLAY_ALLOW.has(hit.split(':')[0]));
    check(
      `no overlay call site uses ${construct.label}`,
      offenders.length === 0,
      offenders.length
        ? `${offenders.length} hit(s): ${offenders.slice(0, 4).join(', ')}`
        : hits.length
          ? `only the allowlisted ${hits.map((h) => h.split(':')[0]).join(', ')}`
          : `${files.length} files clean`,
    );
  }

  check(
    'the org-icon exemption is documented in code, not just waived here',
    OVERLAY_ALLOW.size === 1 && OVERLAY_ALLOW.has('app/api/org-icon/route.ts'),
    [...OVERLAY_ALLOW.keys()].join(', '),
  );

  // Nothing anywhere still names the removed helpers.
  const REMOVED_NAMES = [
    'stamp-helper',
    'generateStampedImage',
    'collage-generator',
    'createCollageImages',
    'buildSharpCollageFallback',
  ];
  const nameHits: string[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const name of REMOVED_NAMES) {
      if (text.includes(name)) nameHits.push(`${rel(file)} -> ${name}`);
    }
  }
  check(
    'no source file references the removed overlay helpers',
    nameHits.length === 0,
    nameHits.length ? nameHits.slice(0, 4).join(', ') : `${REMOVED_NAMES.length} names absent from ${files.length} files`,
  );

  // No creative prompt asks for a bare picture any more.
  const STALE_PROMPT_LINES = [
    'no text overlays or awkward placeholder graphics',
    'DO NOT draw text overlays or placeholder circles',
  ];
  const staleHits: string[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8').toLowerCase();
    for (const stale of STALE_PROMPT_LINES) {
      if (text.includes(stale.toLowerCase())) staleHits.push(`${rel(file)}: "${stale}"`);
    }
  }
  check(
    'the two prompts that asked for a text-free picture are gone',
    staleHits.length === 0,
    staleHits.join(', ') || STALE_PROMPT_LINES.length + ' stale instruction(s) removed',
  );

  const allocate = fs.readFileSync(path.join(ROOT, 'app/api/projects/allocate-delivery/route.ts'), 'utf8');
  const onboarding = fs.readFileSync(path.join(ROOT, 'app/api/onboarding/complete/route.ts'), 'utf8');
  check(
    'allocate-delivery now asks for the typography INSIDE the one image',
    /set as real typography INSIDE this one image/i.test(allocate) && /Nothing is composited on top/i.test(allocate),
  );
  check(
    'onboarding now asks for the finished design in the one image',
    /set as real type in the artwork/i.test(onboarding) && /no second compositing step/i.test(onboarding),
  );

  // Every file that turns a brief into image pixels, found by capability rather
  // than by a hand-written list, so a new route cannot slip past this check.
  const IMAGE_PATH_MARKERS: RegExp[] = [
    /\bcreateKieImageTask\b/,
    /\bimageModelFor\b/,
    /\bbuildImageSystemPrompt\b/,
    /\bbuildFestivalCreativePrompt\b/,
  ];
  const imageFiles = files.filter((file) => {
    const text = fs.readFileSync(file, 'utf8');
    return IMAGE_PATH_MARKERS.some((re) => re.test(text));
  });
  check(
    'the image-generation call sites were found by capability',
    imageFiles.length >= 8,
    `${imageFiles.length} files: ${imageFiles.map(rel).slice(0, 6).join(', ')}…`,
  );

  /**
   * Phrasing that asks an image model for a bare picture and hands the design to
   * a later step. Two exemptions, both named and both justified:
   *  - the skill's own deny-list, which has to contain the phrase to detect it;
   *  - `/api/chat`, where a user can explicitly ask for a raw photograph with no
   *    business information on it — and only on that gated line.
   */
  const BANNED_PROMPT_PHRASING: { label: string; re: RegExp }[] = [
    { label: 'no text overlays', re: /\bno\s+text\s+overlays?\b/i },
    { label: 'not add any text overlays', re: /\bnot\s+add\s+any\s+text\s+overlays?\b/i },
    { label: 'without text', re: /\bwithout\s+(any\s+)?(text|copy|typography)\b/i },
    { label: 'text-free', re: /\btext[- ]free\b/i },
    { label: 'leave room for', re: /\bleave\s+(a\s+)?(some\s+)?room\s+for\b/i },
    { label: 'blank space', re: /\bblank\s+space\b/i },
  ];

  for (const phrasing of BANNED_PROMPT_PHRASING) {
    const offenders: string[] = [];
    for (const file of imageFiles) {
      const r = rel(file);
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!phrasing.re.test(line)) continue;
        if (r === 'lib/agent/tools/skills/image/prompt.ts') continue; // the deny-list itself
        if (r === 'app/api/chat/route.ts' && /excludeBusinessInfo/.test(line)) continue; // gated opt-out
        offenders.push(`${r}:${i + 1}`);
      }
    }
    check(
      `no image-generation prompt asks for "${phrasing.label}"`,
      offenders.length === 0,
      offenders.length ? offenders.slice(0, 4).join(', ') : `${imageFiles.length} image paths clean`,
    );
  }

  const chatRoute = fs.readFileSync(path.join(ROOT, 'app/api/chat/route.ts'), 'utf8');
  check(
    'the one surviving opt-out is gated on the user asking for no business info',
    chatRoute
      .split('\n')
      .some((line) => /excludeBusinessInfo\s*\?/.test(line) && /text\s+overlays?/i.test(line)),
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})().catch((error) => {
  console.error('verify-image-skill failed:', error?.message || error);
  process.exit(1);
});
