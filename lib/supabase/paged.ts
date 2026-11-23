/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase query builders are untyped. */
/**
 * Reading MORE than 1000 rows, on purpose.
 *
 * THE FAILURE THIS FIXES, TWICE
 * PostgREST enforces `max-rows` (1000 on this project) server-side. A query that asks for
 * `.limit(5000)` is silently cut to 1000 rows and returns HTTP 200 with no warning — so code that
 * counts the rows it received reports a confident, wrong number:
 *
 *   - `org_lead_report` asked for 5000, received 1000, and told the owner "1,000 leads all-time
 *     across 6 accounts" when the organisation held ~40,000 and their own account alone held 1,572.
 *     Every stage figure and "reached by phone" count was computed from that truncated slice.
 *   - the same shape was in the WhatsApp campaign runner, where it made a 16,317-lead campaign
 *     report "1000 recipients".
 *
 * So there are exactly two honest ways to read a lot of rows, and this module is both of them:
 *   `exactCount` — ask the database to count, never count what came back;
 *   `scanAll`    — page with `range()` until a short page arrives, knowing the cap is per response.
 *
 * Anything in this codebase that needs "all matching rows" should use one of these. A bare
 * `.limit(n)` with n > 1000 is a bug waiting to be discovered by a customer.
 */

/** Rows per request. This is PostgREST's max-rows; asking for more is silently truncated. */
export const PAGE_SIZE = 1000;

/** Safety ceiling for a scan, so a runaway query cannot hold a turn open for ever. */
export const DEFAULT_SCAN_CAP = 100_000;

export interface ExactCount {
  count: number | null;
  error?: string;
}

/**
 * The exact number of rows a filter matches. One request, `head: true`, no rows transferred.
 *
 * `null` means "the database could not tell us", which must never be reported as zero.
 */
export async function exactCount(build: () => any): Promise<ExactCount> {
  try {
    const { count, error } = await build();
    if (error) return { count: null, error: error.message };
    return { count: typeof count === 'number' ? count : null };
  } catch (e: any) {
    return { count: null, error: e?.message || 'count failed' };
  }
}

export interface ScanResult<T> {
  rows: T[];
  /** Rows actually read. */
  scanned: number;
  /** True when the scan stopped at `cap` before exhausting the match set. */
  capped: boolean;
  /** Exact number of matching rows, when the caller asked for it. */
  exactTotal?: number | null;
  error?: string;
}

export interface ScanOptions {
  /** Cap on rows read. Defaults to DEFAULT_SCAN_CAP. */
  cap?: number;
  /** Pages fetched concurrently. 4 is a good balance for PostgREST. */
  concurrency?: number;
  /** Also ask the database for the exact total (one extra head request). */
  withTotal?: boolean;
}

/**
 * Read every matching row, page by page.
 *
 * `build` must return a FRESH query each call (a builder is single-use): give it a function that
 * applies the filters and select, and this will add `range()` for each page.
 *
 * Pages are fetched in parallel up to `concurrency`, but a short page ends the walk, so a 40k-row
 * read is 40 requests rather than one silent truncation.
 */
export async function scanAll<T = any>(build: () => any, options: ScanOptions = {}): Promise<ScanResult<T>> {
  const cap = Math.max(PAGE_SIZE, Math.min(Number(options.cap ?? DEFAULT_SCAN_CAP), DEFAULT_SCAN_CAP));
  const concurrency = Math.max(1, Math.min(Number(options.concurrency ?? 4), 8));

  let exactTotal: number | null | undefined;
  if (options.withTotal) {
    const total = await exactCount(() => build().select('*', { count: 'exact', head: true }));
    exactTotal = total.count;
  }

  const rows: T[] = [];
  let offset = 0;
  let capped = false;
  let error: string | undefined;

  while (offset < cap) {
    const pages: Array<Promise<any>> = [];
    const pageCount = Math.min(concurrency, Math.ceil((cap - offset) / PAGE_SIZE));

    for (let i = 0; i < pageCount; i++) {
      const from = offset + i * PAGE_SIZE;
      const to = Math.min(from + PAGE_SIZE - 1, cap - 1);
      pages.push(
        Promise.resolve()
          .then(() => build().range(from, to))
          .catch((e: any) => ({ data: null, error: { message: e?.message || 'page failed' } }))
      );
    }

    const results = await Promise.all(pages);
    let sawShortPage = false;

    for (const result of results) {
      if (result?.error) {
        error = result.error.message || String(result.error);
        continue;
      }
      const data = (result?.data || []) as T[];
      rows.push(...data);
      // A short page means the end of the match set, regardless of what the other pages returned.
      if (data.length < PAGE_SIZE) sawShortPage = true;
    }

    if (error && !rows.length) break;
    offset += pageCount * PAGE_SIZE;
    if (sawShortPage) break;
    if (offset >= cap) capped = true;
  }

  return { rows, scanned: rows.length, capped, exactTotal, error };
}

/**
 * Group rows by one or more columns and count them. Exact for what was scanned; the caller reports
 * `capped` so a partial scan cannot be presented as a total.
 */
export function groupCount<T extends Record<string, any>>(rows: T[], columns: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = columns.map((c) => (row[c] === null || row[c] === undefined ? '(null)' : String(row[c]))).join(' / ');
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}
