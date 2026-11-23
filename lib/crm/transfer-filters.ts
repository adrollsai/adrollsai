/**
 * Multi-value filter normalisation for the CRM "filtered bulk transfer" feature.
 *
 * WHY THIS IS A SEPARATE MODULE
 * The transfer modal could only pick ONE campaign, ONE pipeline stage and ONE lead form, so
 * "send every lead from these three campaigns to Priya" meant three passes and three chances to
 * pick the wrong limit. Widening those three fields to multi-select moves real risk into the query
 * builder: the API matches a campaign on `campaign_id` OR on `ad_name` (lead-only rows never got a
 * campaign id), and campaign names in this database genuinely look like
 *
 *     Hiring | Instant Form | 04-11-2026 / operations executive
 *     Whatsapp Leads - Nobogent - 02-10-2026 / static - poppy real estate
 *     "Sarjapur" plots — 2BHK 🏡
 *
 * Commas, pipes, slashes, quotes and emoji. A PostgREST `or=` tree is comma-separated, so
 * interpolating that text raw silently turns one honest condition into several different ones
 * (`ad_name.ilike.%plots — 2BHK 🏡%`, plus a clause per comma) and lets user text restructure the
 * filter — an injection risk, not just a wrong count. Every value therefore goes through
 * `pgQuote()`.
 *
 * Kept pure and framework-free so `scripts/verify-bulk-filters.ts` can assert on the exact strings
 * that reach PostgREST without a database.
 */

/**
 * Values that mean "no filter on this field".
 *
 * The single-select era stored the sentinel `'ALL'` in the modal state and shipped it to the API;
 * older callers still do. `[]` is the multi-select spelling of the same thing, so both must collapse
 * to "no filter" rather than to a filter that matches nothing.
 */
const ALL_SENTINELS = new Set(['all'])

/**
 * Normalise a filter value to a list of real values.
 *
 * Accepts a plain string (back-compat with the old callers) or an array, trims, drops empties,
 * drops the `ALL` sentinel and de-duplicates. An empty result means "no filter on this field".
 * Anything that is not a string/number is ignored rather than stringified — a nested object must
 * not end up inside a PostgREST filter expression.
 */
export function asFilterList(value: unknown): string[] {
  const raw: unknown[] = Array.isArray(value) ? value : [value]
  const out: string[] = []
  const seen = new Set<string>()

  for (const item of raw) {
    if (item === null || item === undefined) continue
    if (typeof item !== 'string' && typeof item !== 'number') continue

    const trimmed = String(item).trim()
    if (!trimmed) continue
    if (ALL_SENTINELS.has(trimmed.toLowerCase())) continue
    if (seen.has(trimmed)) continue

    seen.add(trimmed)
    out.push(trimmed)
  }

  return out
}

/**
 * Quote one value for use inside a PostgREST filter expression.
 *
 * PostgREST accepts double-quoted values anywhere a value may appear, and inside those quotes a
 * backslash escapes the next character — so `"` and `\` must both be backslash-escaped. Quoting
 * every value (not just the ones that look dangerous) is what makes `ad_name.ilike."%Hiring |
 * Instant Form | 04-11-2026 / operations executive%"` a single clause instead of four.
 */
export function pgQuote(value: string): string {
  const escaped = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${escaped}"`
}

/**
 * Pipeline stages to require. `[]` means "every stage"; the caller must not filter at all.
 *
 * Returned as a list rather than an expression because supabase-js builds and quotes `in.(...)`
 * itself, which is the safe way to compare stage names.
 */
export function buildStageFilter(value: unknown): string[] {
  return asFilterList(value)
}

/**
 * One OR-ed PostgREST expression matching each selected record by id OR by name, or `null` when the
 * field is not filtered.
 *
 * Two campaigns produce four clauses — `id.eq` and `name.ilike` for each — because live records are
 * selected by id while labels that only exist on leads are selected by name. All clauses sit in ONE
 * `or=` so the result is "these campaigns", not "the first campaign AND something else".
 */
export function buildIdOrNameOrFilter(
  value: unknown,
  idColumn: string,
  nameColumn: string
): string | null {
  const list = asFilterList(value)
  if (list.length === 0) return null

  const clauses: string[] = []
  for (const item of list) {
    clauses.push(`${idColumn}.eq.${pgQuote(item)}`)
    clauses.push(`${nameColumn}.ilike.${pgQuote(`%${item}%`)}`)
  }

  return clauses.join(',')
}

/** Campaigns: match `campaign_id` exactly, or `ad_name` for rows with no campaign id. */
export function buildCampaignFilter(value: unknown): string | null {
  return buildIdOrNameOrFilter(value, 'campaign_id', 'ad_name')
}

/** Lead forms: match `form_id` exactly, or `form_name` for rows with no form id. */
export function buildFormFilter(value: unknown): string | null {
  return buildIdOrNameOrFilter(value, 'form_id', 'form_name')
}
