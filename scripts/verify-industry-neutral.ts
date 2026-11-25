/**
 * Proves the starter content every account sees is industry-neutral and honest.
 *
 * Two failures this pins down, both shipped and both embarrassing in front of a customer:
 *
 *   1. The AI calling starter rules were one property developer's campaigns — "Joy Grand Luxury
 *      Residences", "Wave City", "3 BHK / 4 BHK", "1.8 Cr to 3.5 Cr" — shown to every account,
 *      a film academy included.
 *   2. They carried invented results: 540 calls placed, 462 connected, 198 qualified, "8 mins ago".
 *      An owner reads those as their own numbers.
 *
 * It reads the component source rather than importing it, because the point is what a user SEES on
 * first load, and the file is the only place that content lives.
 *
 *   npm run verify-industry-neutral (npm run verify:industry-neutral)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

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

const callingSource = readFileSync(
  path.join(process.cwd(), 'app/dashboard/flows/components/ai-calling-view.tsx'),
  'utf8'
);

/** The starter rules block only — the voice studio list below it is fine. */
const defaultsStart = callingSource.indexOf('const DEFAULT_AI_CALLING_RULES');
const defaultsEnd = callingSource.indexOf('const GEMINI_VOICE_STUDIO');
const defaults = callingSource.slice(defaultsStart, defaultsEnd);
check('the starter rules block was found', defaultsStart > 0 && defaultsEnd > defaultsStart, `${defaults.length} chars`);

head('1. No industry is baked into what every account starts with');

{
  const propertyWords = [
    /\bsite visit/i,
    /\bBHK\b/i,
    /\bCr\b/,
    /\bcrore/i,
    /\blakh/i,
    /\bJoy Grand\b/i,
    /\bWave City\b/i,
    /\bresidences?\b/i,
    /\bproperty\b/i,
    /\bproperties\b/i,
    /\bapartment\b/i,
    /\bbuilder\b/i,
  ];
  const hit = propertyWords.filter((pattern) => pattern.test(defaults)).map((pattern) => pattern.source);
  check('no property vocabulary in the starter rules', hit.length === 0, hit.join(', ') || 'clean');

  check('the copy uses placeholders instead of a fixed brand', defaults.includes('{{business}}'), defaults.includes('{{business}}') ? 'yes' : 'missing');
  check('and the lead name is a placeholder', defaults.includes('{{lead.name}}'));
  check('no hardcoded phone number', !/\+91\s?9\d{4}/.test(defaults), /\+91\s?9\d{4}/.test(defaults) ? 'found one' : 'clean');
}

head('2. Nothing claims results that never happened');

{
  // Every stats block in the defaults must be zeroed: an owner reads these as their own numbers.
  const statBlocks = defaults.match(/stats:\s*\{[^}]*\}/g) ?? [];
  check('there are starter stats blocks', statBlocks.length >= 4, `${statBlocks.length} blocks`);
  const nonZero = statBlocks.filter((block) => /callsPlaced:\s*[1-9]/.test(block) || /connected:\s*[1-9]/.test(block) || /qualified:\s*[1-9]/.test(block));
  check('none of them reports calls that never happened', nonZero.length === 0, nonZero.join(' | ') || 'all zero');

  check('no "8 mins ago" style activity claims', !/lastCallAt: '(?!Never)[^']*mins? ago'/.test(defaults), /mins? ago/.test(defaults) ? 'relative time found' : 'clean');
  check('every rule says it has never called', (defaults.match(/lastCallAt: 'Never'/g) ?? []).length === statBlocks.length, `${(defaults.match(/lastCallAt: 'Never'/g) ?? []).length}/${statBlocks.length}`);
  check('every starter rule is paused', (defaults.match(/isActive: false/g) ?? []).length === statBlocks.length);
}

head('3. The rules are still useful patterns');

{
  check('speed-to-lead is one of them', /instant speed-to-lead/i.test(defaults), 'present');
  check('portal enquiries are one of them', /portal enquiry/i.test(defaults));
  check('a cold list is one of them', /cold list/i.test(defaults));
  check('click-to-call is one of them', /call me now/i.test(defaults));
  check('there are four starter rules', (defaults.match(/id: 'rule_/g) ?? []).length === 4, String((defaults.match(/id: 'rule_/g) ?? []).length));
}

/**
 * THE FLOWS PAGE SHIPPED A WHOLE CUSTOMER'S BUSINESS TO EVERY OTHER ACCOUNT.
 *
 * `/dashboard/flows` carried a demo of one property developer: ten invented prospects with
 * real-looking mobile numbers ("Rohit Verma, +91 98765 43210, 2.5 Cr, Mohali"), "3 & 4 BHK
 * Luxury Apartments, Starting 1.8 Cr", fake uploaded lists ("Weekend Site Visit Target Pool
 * (1120)"), a fake "Mohali-Luxury-HNIs-Calling-List.csv", seeded run history with invented
 * counts and durations, and that business's staff, email and phone number in the node defaults.
 * A film academy opening the editor read all of it as its own data.
 *
 * The content is now placeholders. This section keeps it that way: it scans the CODE (comments
 * stripped, because a comment explaining what was removed is not shown to anyone) for the
 * vocabulary and the shapes that came back before.
 */
head('4. The flow editor ships placeholders, not somebody else\'s business');

{
  const pageSource = readFileSync(path.join(process.cwd(), 'app/dashboard/flows/page.tsx'), 'utf8');
  const code = pageSource
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/^\s*\/\/.*$/gm, '') // whole-line comments
    .replace(/\/\/[^\n'"`]*$/gm, ''); // trailing comments
  check('the flows page was read and comments were stripped', code.length > 100_000, `${code.length} chars of code`);

  const banned: Array<[string, RegExp]> = [
    ['property configuration (BHK)', /\bBHK\b/i],
    ['rupee-crore prices', /\bCr\b|\bcrore\b/i],
    ['lakh prices', /\blakh\b/i],
    ['square feet', /\bsq\.?\s?ft\b/i],
    ['HNI segments', /\bHNIs?\b/i],
    ['the old demo localities', /\b(Mohali|Chandigarh|Zirakpur|Kharar|Panchkula|Aerocity)\b/i],
    ['the old demo brand', /\b(Joy Grand|Bluesquare)\b/i],
    ['the old demo salesperson', /\bHarman Bajwa\b/i],
    ['hardcoded mobile numbers', /\+91[\s-]?9\d{4}/],
    ['the fake uploaded lists', /(Calling-List|Retry-List)\.csv/i],
    ['a fixed admin email', /@bluesquareinfra\.com/i],
  ];
  const hits = banned.filter(([, pattern]) => pattern.test(code)).map(([name]) => name);
  check('no invented business, price, place or phone number in the rendered content', hits.length === 0, hits.join(', ') || 'clean');

  // "site visit" as PROSE is property-flavoured; "Site Visit" as a value is a saved CRM stage in
  // real accounts' flows, so renaming it would silently remap their data. Prose only.
  const siteVisit = code.match(/\bsite visits?\b/gi) ?? [];
  const proseSiteVisit = siteVisit.filter((hit) => hit !== 'Site Visit' && hit !== 'Site Visits');
  check('no property-flavoured "site visit" prose', proseSiteVisit.length === 0, proseSiteVisit.join(', ') || 'clean');

  const pool = code.slice(code.indexOf('const PROSPECT_POOL'), code.indexOf('const PROSPECT_POOL') + 600);
  check('the simulator lead is a placeholder, not a person', /\{\{lead\.name\}\}/.test(pool), pool.includes('{{lead.name}}') ? 'yes' : 'missing');
  check('and its phone number is a placeholder too', /\{\{lead\.phone\}\}/.test(pool) && !/9\d{4}\s?\d{5}/.test(pool));

  const history = code.slice(code.indexOf('const [flowRunHistory'), code.indexOf('const [flowRunHistory') + 900);
  check('no seeded batch-run history with invented counts', /\[\s*(?:\/\/[^\n]*\s*)?\]\s*\)/.test(history), history.slice(0, 60).replace(/\s+/g, ' '));
  check('the empty history is explained in place', /No invented history/.test(pageSource));

  check('the audience lists come from the account, not from the file', /const SAMPLE_CSV_AUDIENCES[^=]*=\s*\[\]/.test(code) && /const SAMPLE_AUDIENCE_GROUPS[^=]*=\s*\[\]/.test(code));
  check(
    'launching with an empty audience list says so instead of throwing',
    /if \(!csv\)/.test(code) && /if \(!grp\)/.test(code),
    'indexing [0] on an empty array was a TypeError in production'
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
