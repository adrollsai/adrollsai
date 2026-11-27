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
import { chooseReferenceCreative, describeReferenceChoice } from '../lib/automation/reference-selection';

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
    const choice = await chooseReferenceCreative(stubSupabase(own), 'user-1', {
      selectedTemplateUrl: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/reference-creatives/dubai/pinterest_pin_1793111079523_17.jpg',
      selectedTemplateLabel: 'Golden Hour Oasis Villa',
    });
    check('the account\u2019s own upload wins over any built-in', (choice.url || '').includes('/procolor/poster-'), choice.url || '');
    check('and is reported as the account\u2019s own', choice.source === 'own', choice.source);
    check('the built-in\u2019s badge cannot leak in', !JSON.stringify(choice).includes('Oasis'));
  }

  head('2. Nothing on file means no reference — never a borrowed industry');

  {
    const bare = await chooseReferenceCreative(stubSupabase([]), 'user-2', {});
    check('no own references, nothing selected: no reference at all', bare.url === null, String(bare.url));
    check('and it says so rather than pretending', bare.source === 'none' && /no borrowed design/.test(describeReferenceChoice(bare)), describeReferenceChoice(bare));

    const optIn = await chooseReferenceCreative(stubSupabase([]), 'user-3', {
      selectedTemplateUrl: 'https://cdn.example.com/builtin/villa.jpg',
      selectedTemplateLabel: 'Marbella Contemporary Villa',
    });
    check('a built-in the owner explicitly ticked IS allowed', optIn.source === 'selected' && optIn.url === 'https://cdn.example.com/builtin/villa.jpg', optIn.source);
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

  head('5. The image paths use this rule, not a random built-in');

  {
    const chat = codeOnly(read('app/api/chat/route.ts'));
    check('the image route no longer picks a random built-in', !/getRandomReferenceTemplate\s*\(/.test(chat));
    check('it asks the shared rule instead', /chooseReferenceCreative\(/.test(chat));
    check('and logs where the design came from', /describeReferenceChoice\(/.test(chat));

    const creation = read('app/dashboard/creation/page.tsx');
    check('the Creation tab cannot fall back to a random built-in url', !/randomFallback/.test(creation));
    check('its template resolution allows "no reference"', /templateObj && effTemplate !== 'rotate'|effTemplate && effTemplate !== 'rotate'/.test(creation));
    check('every random built-in pick is gated on the owner ticking one', (creation.match(/userSelected \? getRandomReferenceTemplate\(userSelected\) : null/g) || []).length === 2);

    const worker = read('app/api/cron/auto-generate/worker/route.ts');
    check('the daily-creative worker uses the shared rule too', /chooseReferenceCreative\(/.test(worker));
    check('and the daily creative survives having no blueprint', /chosenTemplate \? / .test(worker));
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

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('verify-reference-choice crashed:', error?.message || error);
  process.exitCode = 1;
});
