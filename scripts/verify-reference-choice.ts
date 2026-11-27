/**
 * WHICH DESIGN A CREATIVE IS BUILT FROM, AND WHOSE BRAND IT WEARS.
 *
 * The bug this pins: a film academy's admin generated an image in the Creation tab and got a
 * cinematography poster carrying "PRIVATE POOL OASIS", a property map-pin and "Check out this premium
 * property!" copy. Measured on that account — Procolor Film Academy, industry `education`,
 * `profiles.selected_templates` empty, NINETEEN rows of its own in `reference_creatives`:
 *
 *   - app/api/chat called getRandomReferenceTemplate(), which draws from the 35 built-in Dubai property
 *     designs, and sent one to the image model as IMAGE 1 while the account's own references sat unused.
 *     The model faithfully reproduced that design's badge, "PRIVATE POOL OASIS";
 *   - the same route never read the brand kit at all, so an account whose enforced rule is "use ONLY
 *     these colours: scarlet #E13C3C, charcoal #1F1F1F, wisteria #92ABE1" was given "champagne gold";
 *   - the last-resort caption hardcoded property copy.
 *
 *   npm run verify:reference-choice
 */
import fs from 'node:fs';
import path from 'node:path';
import { chooseReferenceCreative, describeReferenceChoice, isOwnReferenceCreative, isSuperAdminReference } from '../lib/automation/reference-selection';

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
const head = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 56 - title.length))}`);
const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

/**
 * Comments in these files QUOTE the old behaviour on purpose — that is how the next reader learns why the
 * rule exists ("this used to call getRandomReferenceTemplate()", "it used to say champagne gold"). So the
 * source checks below read code with comments stripped, otherwise they fail on the documentation.
 */
const codeOnly = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');

/** A stand-in for the two chained reads chooseReferenceCreative performs. */
const stubSupabase = (rows: any[] | Error) =>
  ({
    from: () => {
      if (rows instanceof Error) throw rows;
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: async () => ({ data: rows, error: null }),
      };
      return builder;
    },
  }) as any;

async function main() {
  head('1. An account with its own references gets its own references');

  {
    const own = [
      { id: 'r1', url: 'https://cdn.example.com/procolor/poster-a.jpg', category: 'premium', created_at: '2026-11-20' },
      { id: 'r2', url: 'https://cdn.example.com/procolor/poster-b.jpg', category: 'high_converting', created_at: '2026-11-21' },
    ];
    const choice = await chooseReferenceCreative(stubSupabase(own), 'user-1', {});
    check('the account\u2019s own upload is used', (choice.url || '').includes('/procolor/poster-'), choice.url || '');
    check('and is reported as the account\u2019s own', choice.source === 'own', choice.source);
    check('the built-in\u2019s badge cannot leak in', !JSON.stringify(choice).includes('Oasis'));
  }

  head('2. Nothing on file means no reference — never a borrowed industry');

  {
    const bare = await chooseReferenceCreative(stubSupabase([]), 'user-2', {});
    check('no own references: no reference at all', bare.url === null, String(bare.url));
    check('and it says so rather than pretending', bare.source === 'none' && /no borrowed design/.test(describeReferenceChoice(bare)), describeReferenceChoice(bare));
  }

  head('3. The super admin real-estate designs are banned for every account');

  {
    // The operator's rule: "never use the super admin designs for real estate for any account".
    const builtIns = [
      'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/reference-creatives/dubai/pinterest_pin_1793111079523_17.jpg',
      'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/reference-creatives/dubai/pinterest_pin_1793111079523_0.jpg',
      'pinterest_pin_17',
      'pinterest_damac_island',
      'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/reference-creatives/dubai/anything.jpg',
    ];
    for (const url of builtIns) {
      check(`refused: ${url.slice(-42)}`, isSuperAdminReference(url) === true);
    }
    check('an own upload is not mistaken for a built-in', isSuperAdminReference('https://cdn.example.com/procolor/poster-a.jpg') === false);

    // Even stored as if it belonged to the account, a built-in is not a reference.
    const sneaky = await chooseReferenceCreative(
      stubSupabase([{ id: 'x', url: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/reference-creatives/dubai/pinterest_pin_1793111079523_17.jpg', category: '' }]),
      'user-3',
      {},
    );
    check('a built-in row is skipped even if it carries the account\u2019s user_id', sneaky.url === null, String(sneaky.url));

    // And the door for a URL that arrives from a client.
    const ownOnly = await isOwnReferenceCreative(stubSupabase([]), 'user-3', builtIns[0]);
    check('a client-supplied built-in is not an own reference', ownOnly === false);
    const ownUrl = await isOwnReferenceCreative(stubSupabase([{ id: 'r1', url: 'https://cdn.example.com/procolor/poster-a.jpg' }]), 'user-3', 'https://cdn.example.com/procolor/poster-a.jpg');
    check('a client-supplied own upload is accepted', ownUrl === true);
  }

  head('3. Junk is not a reference');

  {
    for (const bad of ['', 'not-a-url', 'https://placehold.co/600x400.png', 'https://cdn.example.com/logo.svg']) {
      const choice = await chooseReferenceCreative(stubSupabase([{ id: 'x', url: bad, category: '' }]), 'user-4', {});
      check(`"${bad || '(empty)'}" is refused as a reference`, choice.url === null, String(choice.url));
    }
    const broken = await chooseReferenceCreative(stubSupabase(new Error('relation does not exist')), 'user-5', {});
    check('a read error does not stop a generation', broken.url === null && broken.source === 'none');
  }

  head('4. The same request picks the same reference');

  {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, url: `https://cdn.example.com/own/${i}.jpg`, category: '' }));
    const a = await chooseReferenceCreative(stubSupabase(many), 'user-6', { seed: 'creative-42' });
    const b = await chooseReferenceCreative(stubSupabase(many), 'user-6', { seed: 'creative-42' });
    check('a seeded choice is stable', a.url === b.url, a.url || '');
    const spread = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const pick = await chooseReferenceCreative(stubSupabase(many), 'user-6', { seed: `creative-${i}` });
      if (pick.url) spread.add(pick.url);
    }
    check('and still spreads across the account\u2019s references', spread.size >= 4, `${spread.size} of 12 used over 40 creatives`);
  }

  head('5. The image paths use this rule, and no built-in survives anywhere');

  {
    const chat = codeOnly(read('app/api/chat/route.ts'));
    check('the image route never picks a built-in', !/getRandomReferenceTemplate\s*\(/.test(chat));
    check('and cannot resolve a built-in from a stored template id', !/getReferenceTemplate\s*\(/.test(chat));
    check('a supplied reference is checked against the account\u2019s own uploads', /isOwnReferenceCreative\(/.test(chat));
    check(
      'a supplied built-in is refused before it can become the reference',
      /if \(effectiveTemplateUrl && isSuperAdminReference\(effectiveTemplateUrl\)\)[\s\S]{0,200}?effectiveTemplateUrl = null;/.test(chat),
    );
    check('it asks the shared rule instead', /chooseReferenceCreative\(/.test(chat));
    check('and logs where the design came from', /describeReferenceChoice\(/.test(chat));

    const creation = codeOnly(read('app/dashboard/creation/page.tsx'));
    check('the Creation tab cannot fall back to a random built-in url', !/randomFallback/.test(creation));
    check('it never resolves a built-in template into a reference', !/templateObj\?\.url|selectedTemplateObj\?\.url/.test(creation));
    check('it no longer imports the built-in random picker', !/getRandomReferenceTemplate/.test(creation));
    check('the Dubai template picker is gone from the creation flow', !/Curated Dubai Templates|Rotate Diverse Luxury Styles/.test(creation));

    const worker = read('app/api/cron/auto-generate/worker/route.ts');
    check('the daily-creative worker uses the shared rule too', /chooseReferenceCreative\(/.test(worker));
    check('and never picks a built-in', !/getRandomReferenceTemplate\s*\(/.test(codeOnly(worker)));
    check('and the daily creative survives having no blueprint', /chosenTemplate \? / .test(worker));

    // The delivery + onboarding paths defaulted to five Dubai designs by id.
    for (const file of ['app/api/onboarding/complete/route.ts', 'app/api/projects/allocate-delivery/route.ts']) {
      const source = codeOnly(read(file));
      check(`${file}: no default list of built-in designs`, !/pinterest_pin_\d/.test(source));
      check(`${file}: a missing template degrades to neutral styling`, /Modern Minimalist Editorial/.test(source));
    }
  }

  head('6. Every image path carries the account\u2019s brand');

  {
    const chat = codeOnly(read('app/api/chat/route.ts'));
    check('the image route reads the brand kit', /brandKitFor\(/.test(chat));
    check('the brand lock is appended to every prompt branch', /if \(finalImagePrompt && brandLock\)/.test(chat));
    check('and it is stated as non-negotiable', /BRAND & INDUSTRY LOCK \(non-negotiable/.test(chat));
    check('the hardcoded "champagne gold" palette is gone', !/champagne gold/i.test(chat));

    const worker = read('app/api/cron/auto-generate/worker/route.ts');
    check('the daily-creative worker reads the brand kit', /brandKitFor\(/.test(worker));
    check('and states the brand rules as non-negotiable', /BRAND RULES \(NON-NEGOTIABLE/.test(worker));
  }

  head('7. No property vocabulary on a business that has none');

  {
    const chat = codeOnly(read('app/api/chat/route.ts'));
    check('the last-resort caption is not property copy', !/premium property/i.test(chat));
    check('the composer is told to translate the examples into this industry', /translate them into this business's own vocabulary/.test(chat));
    check('"explore inventory" is not offered as a generic CTA', !/"Explore Inventory"/.test(chat));
    // The rule may name the banned words — that is the point — but only inside a prohibition.
    check('the ban is stated, not assumed', /NEVER use another industry's vocabulary/.test(chat));

    const worker = read('app/api/cron/auto-generate/worker/route.ts');
    check('the daily creative no longer assumes a luxury interior', !/For real estate, showcase a gorgeous modern luxury apartment interior/.test(worker));
  }

  head('8. No other door: the agent tools, the library screens, the prompt');

  {
    // The agent's own image tool takes arbitrary URLs, so the ban has to hold at that boundary too.
    const media = codeOnly(read('lib/agent/tools/media_studio.ts'));
    check('generate_ai_image screens its references through the ban', /isSuperAdminReference\(/.test(media));
    check('and gives the model the allowed list, not the raw one', /allowed: referenceUrls/.test(media));
    check('a refused reference is reported, not swallowed', /refusedReferences\.length > 0/.test(media));

    const listTool = codeOnly(read('lib/agent/tools/reference_creatives.ts'));
    check('list_reference_creatives no longer reads the built-in catalogue', !/ALL_REFERENCE_TEMPLATES/.test(listTool));
    check('and has no includeExamples escape hatch', !/includeExamples/.test(listTool));
    check('with none of its own it says so plainly', /source: 'none'/.test(listTool));

    const prompt = codeOnly(read('lib/agent/orchestrator.ts'));
    check('the prompt no longer advertises 35 built-in designs', !/35 finished ad designs/.test(prompt));
    check('the prompt says none are available to any account', /not available to any account/.test(prompt));

    const library = codeOnly(read('app/dashboard/reference-library/page.tsx'));
    check('the reference library no longer merges the built-ins in', !/user_id\.is\.null`?\)?[\s\S]{0,40}or\(/.test(library) && !/query\.or\(`user_id/.test(library));

    const onboarding = codeOnly(read('app/dashboard/onboarding/page.tsx'));
    check('onboarding has no catalogue import left', !/ALL_REFERENCE_TEMPLATES/.test(onboarding));
    check('onboarding no longer preselects built-in designs', !/pinterest_pin_\d/.test(onboarding));
    check('onboarding tells the truth about where the look comes from', /How your creatives get their look|built from your own designs/.test(onboarding));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}
main().catch((error) => {
  console.error('verify-reference-choice crashed:', error?.message || error);
  process.exitCode = 1;
});
