/**
 * The filtered bulk transfer's multi-select filters: does the query we build actually say what the
 * admin picked?
 *
 * THE FAILURE THIS IS REALLY ABOUT
 * "Send every lead from these three campaigns to Priya" used to be impossible — the Campaign filter
 * held one string. Widening it to an array puts user text (campaign/form names, which in this
 * database really do contain commas, pipes, slashes, quotes and emoji) inside a PostgREST `or=`
 * tree, where a comma is a clause separator:
 *
 *     ad_name.ilike.%Hiring | Instant Form | 04-11-2026 / operations executive%
 *
 * is fine, but
 *
 *     ad_name.ilike.%Whatsapp Leads - Nobogent - 02-10-2026 / static - poppy real estate%
 *
 * is not the danger — the danger is any name with a comma, which silently becomes TWO conditions,
 * changing what gets transferred while the preview still shows a confident number. So this gate
 * asserts on the exact expression string handed to PostgREST, clause by clause, and refuses to
 * accept "it compiles".
 *
 * Pure: no database, no network. Every case is a value in, a string out.
 *
 *   npx tsx scripts/verify-bulk-filters.ts
 */
import {
  asFilterList,
  buildCampaignFilter,
  buildFormFilter,
  buildStageFilter,
  buildIdOrNameOrFilter,
  pgQuote,
} from '../lib/crm/transfer-filters';

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
const eq = (name: string, actual: unknown, expected: unknown) =>
  check(name, actual === expected, actual === expected ? '' : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

/** Clause count for an `or=` expression: split on commas that are OUTSIDE double quotes. */
const splitClauses = (expression: string): string[] => {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < expression.length; i++) {
    const ch = expression[i];
    if (ch === '\\' && inQuotes) {
      current += ch + (expression[i + 1] ?? '');
      i++;
      continue;
    }
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === ',' && !inQuotes) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) out.push(current);
  return out;
};

// ── 1. normalisation: string or array in, a list of real values out
console.log('\n▸ asFilterList: one value, many values, and "no filter"');
eq('a plain string still works (old callers)', asFilterList('Contacted').join('|'), 'Contacted');
eq('an array of strings is passed through', asFilterList(['A', 'B']).join('|'), 'A|B');
eq('an empty array means no filter', asFilterList([]).length, 0);
eq('undefined means no filter', asFilterList(undefined).length, 0);
eq('null means no filter', asFilterList(null).length, 0);
eq('the old ALL sentinel is dropped', asFilterList('ALL').length, 0);
eq('the lowercase all sentinel is dropped too', asFilterList('all').length, 0);
eq('ALL inside an array is dropped, the rest survive', asFilterList(['ALL', 'Contacted']).join('|'), 'Contacted');
eq('surrounding whitespace is trimmed', asFilterList('  Warm  ').join('|'), 'Warm');
eq('blank strings are dropped', asFilterList(['', '   ', 'Warm']).join('|'), 'Warm');
eq('duplicates are removed, first occurrence order kept', asFilterList(['B', 'A', 'B']).join('|'), 'B|A');
eq('non-text values are ignored, never stringified', asFilterList([{ evil: 'or=(id.neq.0)' }, 'Warm']).join('|'), 'Warm');
eq(
  'a value that merely CONTAINS "all" is not a sentinel',
  asFilterList(['All Campaigns', 'Installment']).join('|'),
  'All Campaigns|Installment',
);
eq('a number is accepted as text', asFilterList([2026]).join('|'), '2026');

// ── 2. quoting: the whole point
console.log('\n▸ pgQuote: nothing the admin typed can restructure the filter');
eq('a plain value is still quoted', pgQuote('Warm'), '"Warm"');
eq('a comma stays inside the quotes', pgQuote('a,b'), '"a,b"');
eq('a pipe stays inside the quotes', pgQuote('Hiring | Instant Form'), '"Hiring | Instant Form"');
eq('a slash stays inside the quotes', pgQuote('04-11-2026 / operations executive'), '"04-11-2026 / operations executive"');
eq('an embedded quote is backslash-escaped', pgQuote('the "best" lead'), '"the \\"best\\" lead"');
eq('a backslash is backslash-escaped', pgQuote('a\\b'), '"a\\\\b"');
eq('throwing a full PostgREST expression at it changes nothing structural', pgQuote('x,id.neq.0'), '"x,id.neq.0"');
eq(
  'emoji and dots survive untouched',
  pgQuote('"Sarjapur" plots — 2BHK 🏡'),
  '"\\"Sarjapur\\" plots — 2BHK 🏡"',
);

// ── 3. stages: one value, a list, or nothing
console.log('\n▸ buildStageFilter: a list of stages, or nothing at all');
eq('a single stage (old shape) is a one-item list', buildStageFilter('Contacted').join('|'), 'Contacted');
eq('several stages are all kept', buildStageFilter(['New Lead', 'Contacted', 'Warm']).length, 3);
eq('ALL produces no stage filter', buildStageFilter('ALL').length, 0);
eq('an empty array produces no stage filter', buildStageFilter([]).length, 0);
eq('duplicate stages collapse', buildStageFilter(['Warm', 'Warm']).join('|'), 'Warm');
eq(
  'a stage list is applied with in(), so a comma in a stage name cannot split it',
  `pipeline_stage.in.(${buildStageFilter(['Visit Planned', 'Requirement Taken']).join(',')})`,
  'pipeline_stage.in.(Visit Planned,Requirement Taken)',
);

// ── 4. campaigns: id OR name, per campaign, all OR-ed in ONE expression
console.log('\n▸ buildCampaignFilter: several campaigns, still one condition');
const ID_A = '6f1c2b7e-1111-4a2b-9c3d-000000000001';
const ID_B = '6f1c2b7e-2222-4a2b-9c3d-000000000002';
const NAME_WITH_COMMA = 'Hiring | Instant Form | 04-11-2026 / operations executive, batch 2';
const NAME_PLAIN = 'Whatsapp Leads - Nobogent - 02-10-2026 / static - poppy real estate';

eq('no campaign picked means no campaign filter', buildCampaignFilter([]), null);
eq('the legacy ALL sentinel means no campaign filter', buildCampaignFilter('ALL'), null);
eq('a single string still works', buildCampaignFilter('Diwali 2026') !== null, true);

const one = buildCampaignFilter('Diwali 2026') as string;
eq(
  'one campaign is an id-match OR a name-match',
  one,
  'campaign_id.eq."Diwali 2026",ad_name.ilike."%Diwali 2026%"',
);
eq('one campaign is exactly two clauses', splitClauses(one).length, 2);

const two = buildCampaignFilter([ID_A, ID_B]) as string;
eq('two campaigns are FOUR clauses, all in one expression', splitClauses(two).length, 4);
eq(
  'two campaigns match every id OR every name',
  splitClauses(two).join(' ; '),
  `campaign_id.eq."${ID_A}" ; ad_name.ilike."%${ID_A}%" ; campaign_id.eq."${ID_B}" ; ad_name.ilike."%${ID_B}%"`,
);

const comma = buildCampaignFilter([NAME_WITH_COMMA]) as string;
eq(
  'a campaign name containing a comma is ONE quoted value, not two clauses',
  splitClauses(comma).length,
  2,
);
eq(
  'and the comma is still inside the quotes',
  splitClauses(comma)[1],
  `ad_name.ilike."%${NAME_WITH_COMMA}%"`,
);
const rawInterpolation = splitClauses(`ad_name.ilike.%${NAME_WITH_COMMA}%`);
check(
  'the unquoted interpolation this replaced leaks a clause out of the name',
  rawInterpolation.length > 1 && rawInterpolation.some((c) => !/^(campaign_id\.eq|ad_name\.ilike)\."/.test(c)),
  `raw text splits into ${JSON.stringify(rawInterpolation)}, quoted stays one clause`,
);

const mixed = buildCampaignFilter([ID_A, NAME_PLAIN]) as string;
eq('an id and a name can be mixed in one selection', splitClauses(mixed).length, 4);
check(
  'every clause starts with a quoted value, so no user text is raw',
  splitClauses(mixed).every((c) => /^(campaign_id\.eq|ad_name\.ilike)\."/.test(c)),
  splitClauses(mixed).join(' | ').slice(0, 120),
);
check(
  'the slashes and dashes of a real campaign name survive verbatim',
  mixed.includes(`/ static - poppy real estate%"`),
);
eq('duplicate campaign selections do not double the clauses', splitClauses(buildCampaignFilter([ID_A, ID_A]) as string).length, 2);

const quoted = buildCampaignFilter(['the "best" campaign']) as string;
check(
  'a campaign named with quotes stays one clause and is escaped',
  splitClauses(quoted).length === 2 && quoted.includes('\\"best\\"'),
  quoted.slice(0, 100),
);
eq(
  'emoji in a campaign name is preserved',
  (buildCampaignFilter(['Diwali 🪔 2026']) as string).includes('Diwali 🪔 2026'),
  true,
);
check(
  'the count carries no clause of its own (an injection attempt stays a value)',
  splitClauses(buildCampaignFilter(['x,id.neq.0']) as string).length === 2,
  buildCampaignFilter(['x,id.neq.0']) as string,
);

// ── 5. forms: same treatment, different columns
console.log('\n▸ buildFormFilter: same treatment, form_id / form_name');
eq('no form picked means no form filter', buildFormFilter([]), null);
eq('the legacy ALL sentinel means no form filter', buildFormFilter('ALL'), null);
eq(
  'one form is an id-match OR a name-match',
  buildFormFilter('Website Enquiry'),
  'form_id.eq."Website Enquiry",form_name.ilike."%Website Enquiry%"',
);
const forms = buildFormFilter(['form-1', 'form-2']) as string;
eq('two forms are four clauses', splitClauses(forms).length, 4);
check(
  'forms never touch the campaign columns',
  !forms.includes('campaign_id') && !forms.includes('ad_name'),
  forms.slice(0, 80),
);
check(
  'a form name with a comma is quoted, not split',
  splitClauses(buildFormFilter(['Enquiry, Landing Page']) as string).length === 2,
);
eq(
  'the generic builder is the one both wrappers use',
  buildIdOrNameOrFilter('x', 'form_id', 'form_name'),
  buildFormFilter('x'),
);

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
