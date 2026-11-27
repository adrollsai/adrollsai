/**
 * How the CRM loads a large lead book without freezing.
 *
 * MEASURED, on the 16,415-lead workspace:
 *   total payload for a full load   ~32 MB, 17 requests
 *   one page of 1,000 rows          ~1.7-2.1 MB, ~600 ms
 *   of which custom_fields         48%     } 73% of the bytes are two columns
 *   of which notes                 25%     }
 *
 * So "load every lead" is a 32 MB download followed by 16,000 rows of JSON.parse — before the first
 * screen is useful. The old code did exactly that, and worse: it re-sorted the whole accumulated list
 * on every page that landed, so 16 pages meant 16 sorts over arrays growing to 16,415 and 16 table
 * re-renders. That is the "hell lot of time".
 *
 * The shape here is: paint the newest page immediately, pull a small bounded window in the background,
 * and fetch the rest only when someone asks for it. Pages arrive out of order, so they are merged by
 * page index — the server already sorted them, which is what makes re-sorting unnecessary.
 *
 * Pure, so the arithmetic is provable without a browser.
 */

export const LEAD_PAGE_SIZE = 1000;

/**
 * How many pages to load without being asked.
 *
 * Three pages ≈ 3,000 newest leads ≈ 5 MB. That covers the work a CRM is actually used for (today's
 * leads, this week's follow-ups) and keeps the first screen fast on a 16,000-lead book. Anything older
 * is one tap away.
 */
export const EAGER_PAGE_COUNT = 3;

/** How many pages to request at a time when the owner does ask for everything. */
export const BACKGROUND_BATCH_SIZE = 4;

/** Pages 0..(n-1) — the ones loaded without being asked, bounded by what exists. */
export function eagerPageIndexes(totalRows: number, pageSize = LEAD_PAGE_SIZE, eager = EAGER_PAGE_COUNT): number[] {
  const pages = Math.max(1, Math.ceil(Math.max(0, totalRows) / pageSize));
  return Array.from({ length: Math.min(pages, Math.max(1, eager)) }, (_, index) => index);
}

/** The pages left after the eager window — what "load all" has to fetch. */
export function remainingPageIndexes(
  totalRows: number,
  alreadyLoadedPages: number,
  pageSize = LEAD_PAGE_SIZE
): number[] {
  const pages = Math.max(0, Math.ceil(Math.max(0, totalRows) / pageSize));
  return Array.from({ length: Math.max(0, pages - alreadyLoadedPages) }, (_, index) => alreadyLoadedPages + index);
}

/** Split a list of pages into batches, so a 17-page book does not open 17 requests at once. */
export function batchesOf<T>(items: T[], size = BACKGROUND_BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

/** The PostgREST range for a page, inclusive — the numbers the query needs. */
export function pageRange(pageIndex: number, pageSize = LEAD_PAGE_SIZE): { from: number; to: number } {
  const from = Math.max(0, Math.floor(pageIndex)) * pageSize;
  return { from, to: from + pageSize - 1 };
}

/**
 * The columns every lead page query must order by, in order: NEWEST ACTIVITY FIRST, THEN ID.
 *
 * `last_activity_at` alone is not a total order, and PostgREST pages are separate HTTP requests, so
 * ties are not broken the same way twice. Measured on the live books: one bulk import stamps 1,350 of
 * Bioque's 1,717 leads with the IDENTICAL `last_activity_at`, and ProEstate has 1,546 leads sharing
 * one. With 1,000-row pages, a tie group that straddles a page boundary makes page 1 and page 2
 * overlap — the same lead rendered twice — while other tied leads are returned by neither request and
 * never appear at all. That is the "duplicate cards" and the list that disagrees with its own count.
 *
 * `id` is unique, so appending it makes every page boundary deterministic and the pages disjoint.
 */
export const LEAD_ORDER_COLUMNS = ['last_activity_at', 'id'] as const;

/**
 * Apply the lead ordering to a PostgREST query.
 *
 * Kept as a passthrough so callers keep the full builder type (`.range()`, `.select()` chains) without
 * this module importing the client. `any` on the two `.order` calls is deliberate: postgrest-js types
 * those column names against the table schema, which this pure module does not know.
 */
export function orderLeadsDesc<Q>(query: Q): Q {
  return (query as any)
    .order(LEAD_ORDER_COLUMNS[0], { ascending: false })
    .order(LEAD_ORDER_COLUMNS[1], { ascending: false });
}

/**
 * Merge pages that arrived in any order into one correctly ordered list.
 *
 * The server orders by `last_activity_at` then `id` descending, so page 0 holds the newest rows and
 * page 15 the oldest. Concatenating in page order therefore reproduces the server's ordering exactly —
 * no client sort, and no 16 sorts of a growing 16,000-row array.
 *
 * Rows are keyed by `id` as they are merged. A stable order should already make pages disjoint; this
 * is the guarantee that a lead cannot be shown twice even if a page is fetched twice (a retry), or a
 * row is touched between two requests and shifts across the boundary. `sortByActivity` remains the
 * final safety net for a page that arrives with a different shape.
 */
export function mergePages<T extends { id?: string | null }>(pages: Map<number, T[]>): T[] {
  const ordered = [...pages.entries()].sort((a, b) => a[0] - b[0]);
  const merged: T[] = [];
  const seen = new Set<string>();
  for (const [, rows] of ordered) {
    for (const row of rows) {
      const id = row && row.id ? String(row.id) : null;
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      merged.push(row);
    }
  }
  return merged;
}

/** Newest first, used once at the end rather than after every page. */
export function sortByActivity<T extends { last_activity_at?: string | null; created_at?: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const at = new Date(a.last_activity_at || a.created_at || 0).getTime();
    const bt = new Date(b.last_activity_at || b.created_at || 0).getTime();
    return bt - at;
  });
}

/** What the "load more" affordance should say, or null when everything is already in memory. */
export function loadMoreLabel(loadedRows: number, totalRows: number): string | null {
  if (totalRows <= loadedRows) return null;
  const remaining = totalRows - loadedRows;
  return `Load the other ${remaining.toLocaleString('en-IN')} of ${totalRows.toLocaleString('en-IN')} leads`;
}
