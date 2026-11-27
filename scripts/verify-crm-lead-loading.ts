/**
 * Proves the CRM loads a big lead book in a bounded, ordered, non-freezing way.
 *
 * Measured on the 16,415-lead workspace before this change: every page of every lead (17 requests,
 * ~32 MB) was pulled on page load, and the whole accumulated array was re-sorted each time a page
 * landed. These checks pin the arithmetic that replaced it, because "it loaded all 16,000" is exactly
 * the behaviour that made the tab unusable.
 *
 *   npm run verify:crm-lead-loading
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  BACKGROUND_BATCH_SIZE,
  EAGER_PAGE_COUNT,
  LEAD_ORDER_COLUMNS,
  LEAD_PAGE_SIZE,
  batchesOf,
  eagerPageIndexes,
  loadMoreLabel,
  mergePages,
  orderLeadsDesc,
  pageRange,
  remainingPageIndexes,
  sortByActivity,
} from '../lib/crm/lead-pagination';

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

const BIG = 16_415; // Blue Square Infra, the account this was measured on
const SMALL = 1_584; // the owner's own workspace

head('1. A big book loads a bounded window, not everything');

{
  const eager = eagerPageIndexes(BIG);
  check('the eager window is exactly three pages', eager.length === EAGER_PAGE_COUNT, `${eager.length} pages`);
  check('and they are the newest pages, in order', JSON.stringify(eager) === '[0,1,2]', JSON.stringify(eager));
  check('3,000 leads, not 16,415', eager.length * LEAD_PAGE_SIZE === 3000, String(eager.length * LEAD_PAGE_SIZE));

  const remaining = remainingPageIndexes(BIG, eager.length);
  check('the rest is 14 pages', remaining.length === 14, `${remaining.length} pages`);
  check('starting where the eager window stopped', remaining[0] === 3, String(remaining[0]));
  check('and reaching the last page', remaining[remaining.length - 1] === Math.ceil(BIG / LEAD_PAGE_SIZE) - 1, String(remaining[remaining.length - 1]));

  check('a small account still loads everything at once', eagerPageIndexes(SMALL).length === 2, `${eagerPageIndexes(SMALL).length} pages`);
  check('an empty account asks for one page, not zero', eagerPageIndexes(0).length === 1);
  check('and has nothing left to load', remainingPageIndexes(0, 1).length === 0);
}

head('2. Requests go out in batches, not all at once');

{
  const remaining = remainingPageIndexes(BIG, EAGER_PAGE_COUNT);
  const batches = batchesOf(remaining);
  check('14 pages become 4 batches of at most 4', batches.length === 4 && batches.every((batch) => batch.length <= BACKGROUND_BATCH_SIZE), batches.map((b) => b.length).join(','));
  check('every page appears exactly once', batches.flat().length === 14 && new Set(batches.flat()).size === 14);
  check('batches keep their order', JSON.stringify(batches.flat()) === JSON.stringify(remaining));
}

head('3. Page ranges are the numbers PostgREST needs');

{
  check('page 0 is rows 0..999', JSON.stringify(pageRange(0)) === '{"from":0,"to":999}', JSON.stringify(pageRange(0)));
  check('page 15 is rows 15000..15999', JSON.stringify(pageRange(15)) === '{"from":15000,"to":15999}', JSON.stringify(pageRange(15)));
  check('a negative page cannot request negative rows', pageRange(-3).from === 0);
}

head('4. Pages that arrive out of order keep the server\u2019s order');

{
  // Pages land as they finish; this is the merge that replaced 16 client-side sorts.
  const pages = new Map<number, any[]>();
  pages.set(1, [{ id: 'a1', last_activity_at: '2026-11-25T10:00:00Z' }]);
  pages.set(0, [{ id: 'a0', last_activity_at: '2026-11-25T12:00:00Z' }]);
  pages.set(2, [{ id: 'a2', last_activity_at: '2026-11-24T10:00:00Z' }]);

  const merged = mergePages(pages);
  check('page order wins over arrival order', merged.map((row) => row.id).join(',') === 'a0,a1,a2', merged.map((row) => row.id).join(','));
  check('nothing is dropped', merged.length === 3);
  check('the result is already newest-first', sortByActivity(merged).map((row) => row.id).join(',') === 'a0,a1,a2');

  const withGap = new Map<number, any[]>([[0, [{ id: 'x' }]], [2, [{ id: 'z' }]]]);
  check('a missing page does not break the merge', mergePages(withGap).map((row) => row.id).join(',') === 'x,z');
}

head('5. The owner is told what is loaded');

{
  check('nothing to say when everything is in memory', loadMoreLabel(3000, 3000) === null);
  check('a big gap is described with real numbers', loadMoreLabel(3000, BIG)?.includes('13,415') === true, String(loadMoreLabel(3000, BIG)));
  check('and names the total', loadMoreLabel(3000, BIG)?.includes('16,415') === true, String(loadMoreLabel(3000, BIG)));
  check('a small tail still offers the rest', loadMoreLabel(1500, 1584)?.includes('84') === true, String(loadMoreLabel(1500, 1584)));
}

head('6. Pages are disjoint, because the order is total');

{
  /**
   * One bulk import stamps 1,350 of Bioque's 1,717 leads with the SAME `last_activity_at`, and ProEstate
   * has 1,546 sharing one. Ordering on that column alone leaves ties for Postgres to break however it
   * likes per request, so page 1 and page 2 overlap (a duplicate card) while other tied leads fall
   * between them and never appear. `id` as the second column makes the order total.
   */
  check('the tiebreaker is a unique column', LEAD_ORDER_COLUMNS.length === 2 && LEAD_ORDER_COLUMNS[1] === 'id', LEAD_ORDER_COLUMNS.join(' then '));
  check('activity still leads, so a reopened cold lead stays on top', LEAD_ORDER_COLUMNS[0] === 'last_activity_at');

  const recorded: Array<{ column: string; ascending?: boolean }> = [];
  const fakeQuery = {
    order(column: string, options?: { ascending?: boolean }) {
      recorded.push({ column, ascending: options?.ascending });
      return fakeQuery;
    },
    range(from: number, to: number) {
      recorded.push({ column: `range:${from}-${to}` });
      return fakeQuery;
    },
  };
  const returned = orderLeadsDesc(fakeQuery);
  check('the helper applies both columns, newest first', JSON.stringify(recorded) === '[{"column":"last_activity_at","ascending":false},{"column":"id","ascending":false}]', JSON.stringify(recorded));
  check('and hands the builder back so .range() still chains', returned === fakeQuery);

  // The guarantee itself: a row returned by two pages is shown once.
  const overlapping = new Map<number, any[]>([
    [0, [{ id: 'lead-1' }, { id: 'lead-2' }]],
    [1, [{ id: 'lead-2' }, { id: 'lead-3' }]],
  ]);
  const deduped = mergePages(overlapping);
  check('a lead returned by two pages is rendered once', deduped.map((row) => row.id).join(',') === 'lead-1,lead-2,lead-3', deduped.map((row) => row.id).join(','));
  check('de-duplication keeps the first (newest) position', deduped[1]?.id === 'lead-2');
  check('rows without an id are never dropped', mergePages(new Map<number, any[]>([[0, [{ name: 'no-id' }]]])).length === 1);
}

head('7. The page actually uses the tiebreaker');

{
  // A gate on the module proves nothing if the screen passes its own `.order()` instead.
  const source = fs.readFileSync(path.join(process.cwd(), 'app/dashboard/crm/page.tsx'), 'utf8');
  const helperCalls = source.match(/orderLeadsDesc\(/g)?.length ?? 0;
  check('all three lead queries go through orderLeadsDesc()', helperCalls === 3, `${helperCalls} call sites`);
  check('no lead query orders on last_activity_at by hand', !/\.order\('last_activity_at'/.test(source));
  check('the helper is imported', /orderLeadsDesc,/.test(source));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;