/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase rows and RPC results are untyped. */
/**
 * The scoped data primitive: ask any question of the account's own rows.
 *
 * THE GAP THIS FILLS
 * The reporting tools answer the questions someone thought of in advance — `org_lead_report`,
 * `org_call_report`, `ceo_report`, `call_queue_status`. A measured conversation shows the cost: asked
 * "how many of MY leads have never been contacted", the agent called the org-wide report (which said
 * "6 accounts in scope"), discovered `nobogent_crm_query_leads` truncates at 100 rows, then issued
 * ELEVEN `find_tools` searches for an account-scoped count, found nothing, and answered from the
 * calling queue with a scope disclaimer the owner had to read around. The number was right; getting
 * to it took eleven failed lookups and an apology.
 *
 * So this exposes the primitives instead of more answers: count, list, aggregate (group by), distinct
 * and date-bounded scans over the tables that belong to an account — with the SCOPE decided by the
 * caller's role in code, never by the model, and never by a `user_id` the model supplies.
 *
 * SCOPE RULES (enforced here, not in the prompt)
 *   me    the caller only. Always allowed.
 *   org   the caller plus every account under it (profiles.parent_id / agency_id). Allowed for
 *         agency / admin / super_admin.
 *   all   every account on the platform. super_admin only, and it says so in the answer.
 * A `user_id` in a filter is refused outright: filters can narrow within the scope, never widen it.
 *
 * HONESTY RULES
 *  - `count` uses an exact head count, so it is right at any size (this is the number the reporting
 *    tools could not give per account).
 *  - `aggregate` / `distinct` / `list` scan rows; the scan is capped and the result SAYS when it hit
 *    the cap rather than presenting a partial number as a total.
 *  - Credentials are not in the map at all, so they cannot be selected.
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

import { QUERYABLE_TABLE_NAMES, queryableTable } from '../data/column-map';

/** Rows one aggregate/distinct scan may read before it reports itself as capped. */
export const MAX_SCAN_ROWS = 60_000;
/** Page size for a scan. PostgREST caps at 1000 per response, so this is also the hard ceiling. */
const SCAN_PAGE = 1_000;
/** A list response is for reading, not for dumping a table into the context. */
const MAX_LIST_ROWS = 200;
/** Columns never allowed in a filter, whatever the map says. */
const FORBIDDEN_FILTER_COLUMNS = ['user_id', 'owner_id', 'profile_id', 'id'];

export type QueryScope = 'me' | 'org' | 'all';

export interface ScopeResolution {
  ok: boolean;
  error?: string;
  /** The scope that will actually be used. */
  scope?: QueryScope;
  role?: string;
  /** Account ids the filter will be applied to. Null means "no filter" (platform-wide, super admin). */
  accountIds?: string[] | null;
  /** Accounts in scope, for the answer. */
  accountCount?: number;
  label?: string;
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function normaliseRole(raw: unknown): string {
  return clean(raw).toLowerCase();
}

/**
 * Which accounts may this caller read, and under which scope name?
 *
 * Pure in its inputs (a profile row and a child list) so the rules are testable without a database —
 * this is the one function that decides whether a tenant can see another tenant's rows.
 */
export function resolveScopeFrom(
  requested: string | undefined | null,
  caller: { id: string; role?: string | null; parent_id?: string | null; agency_id?: string | null },
  children: Array<{ id: string }> = [],
  platformAccounts?: Array<{ id: string }> | null
): ScopeResolution {
  const role = normaliseRole(caller.role);
  const wants = (clean(requested) || 'me').toLowerCase() as QueryScope;

  const isSuperAdmin = role === 'super_admin';
  const isAgency = role === 'agency';
  const childIds = (children || []).map((c) => clean(c.id)).filter(Boolean);
  /** An account may read what it actually owns: itself, plus any accounts genuinely linked under it. */
  const ownsChildren = childIds.length > 0;
  const isOrgAdmin = isSuperAdmin || isAgency || ownsChildren;
  const orgIds = [...new Set([caller.id, ...childIds])];

  if (wants === 'all') {
    if (!isSuperAdmin) {
      return {
        ok: false,
        error:
          `scope "all" is platform-wide and is only available to a super admin. ` +
          `This account is "${role || 'a tenant'}", so it can read its own rows ("me")` +
          (isOrgAdmin ? ' or those of the accounts under it ("org").' : '.'),
      };
    }
    const ids = platformAccounts ? platformAccounts.map((a) => clean(a.id)).filter(Boolean) : null;
    return {
      ok: true,
      scope: 'all',
      role,
      accountIds: ids,
      accountCount: ids ? ids.length : undefined,
      label: ids ? `every account on the platform (${ids.length})` : 'every account on the platform',
    };
  }

  if (wants === 'org') {
    if (!isOrgAdmin) {
      return {
        ok: false,
        error:
          `scope "org" needs either an agency/super_admin role or sub-accounts actually linked under this ` +
          `account. This account is "${role || 'a tenant'}" with no linked accounts, so "me" is the whole of ` +
          'the data it owns.',
      };
    }
    return {
      ok: true,
      scope: 'org',
      role,
      accountIds: orgIds,
      accountCount: orgIds.length,
      label:
        orgIds.length > 1
          ? `the whole organisation (${orgIds.length} accounts, including this one)`
          : 'the whole organisation (this account only — no sub-accounts are linked)',
    };
  }

  return {
    ok: true,
    scope: 'me',
    role,
    accountIds: [caller.id],
    accountCount: 1,
    label: 'this account only',
  };
}

export interface FilterSpec {
  column: string;
  op: 'eq' | 'neq' | 'in' | 'ilike' | 'gte' | 'lte' | 'gt' | 'lt' | 'is_null' | 'not_null' | 'contains';
  value?: unknown;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  filters?: FilterSpec[];
  columns?: string[];
}

/**
 * Validate a request against the table's real columns. Pure.
 *
 * Refuses a `user_id` filter (that is the scope, and the scope is not negotiable), a column the table
 * does not have, an operator that does not fit the value, and a `contains` on anything that is not an
 * array or JSON column.
 */
export function validateQuery(input: {
  table: string;
  columns?: string[];
  filters?: FilterSpec[];
  groupBy?: string[];
  metrics?: Array<{ fn: string; column?: string }>;
  orderBy?: string;
}): ValidationResult {
  const spec = queryableTable(input.table);
  if (!spec) {
    return {
      ok: false,
      error: `"${input.table}" is not a table this tool can read. Available: ${QUERYABLE_TABLE_NAMES.join(', ')}.`,
    };
  }

  const has = (column: string) => spec.columns.includes(column);

  for (const column of input.columns || []) {
    if (!has(column)) {
      return { ok: false, error: `"${column}" is not a column on ${input.table}. Ask for one of: ${spec.columns.slice(0, 40).join(', ')}${spec.columns.length > 40 ? '…' : ''}` };
    }
  }
  for (const column of input.groupBy || []) {
    if (!has(column)) return { ok: false, error: `cannot group by "${column}": not a column on ${input.table}` };
  }
  for (const metric of input.metrics || []) {
    if (!['count', 'sum', 'avg', 'min', 'max'].includes(metric.fn)) {
      return { ok: false, error: `unsupported metric "${metric.fn}". Use count, sum, avg, min or max.` };
    }
    if (metric.fn !== 'count' && !metric.column) {
      return { ok: false, error: `${metric.fn} needs a column` };
    }
    if (metric.column && !has(metric.column)) {
      return { ok: false, error: `${metric.fn} column "${metric.column}" is not on ${input.table}` };
    }
  }
  if (input.orderBy && !has(input.orderBy)) {
    return { ok: false, error: `cannot order by "${input.orderBy}": not a column on ${input.table}` };
  }

  const filters: FilterSpec[] = [];
  for (const filter of input.filters || []) {
    const column = clean(filter.column);
    const op = filter.op;

    if (FORBIDDEN_FILTER_COLUMNS.includes(column) && column !== 'id') {
      return {
        ok: false,
        error:
          `"${column}" is the scope column and cannot be filtered on: the tool applies the scope itself. ` +
          'Use scope "me" / "org" instead. ("id" may only be used to read one specific row.)',
      };
    }
    if (!has(column)) {
      return { ok: false, error: `cannot filter on "${column}": not a column on ${input.table}` };
    }
    if (op === 'in') {
      if (!Array.isArray(filter.value) || filter.value.length === 0) {
        return { ok: false, error: `"in" needs a non-empty list of values (${column})` };
      }
      if (filter.value.length > 200) return { ok: false, error: `"in" accepts at most 200 values (${column})` };
    } else if (op !== 'is_null' && op !== 'not_null' && (filter.value === undefined || filter.value === null || filter.value === '')) {
      return { ok: false, error: `"${op}" on "${column}" needs a value` };
    }
    filters.push({ column, op, value: filter.value });
  }

  return { ok: true, filters, columns: input.columns };
}

/** Apply the validated filters to a PostgREST query builder. */
function applyFilters(query: any, filters: FilterSpec[]) {
  let q = query;
  for (const filter of filters) {
    switch (filter.op) {
      case 'eq':
        q = q.eq(filter.column, filter.value);
        break;
      case 'neq':
        q = q.neq(filter.column, filter.value);
        break;
      case 'in':
        q = q.in(filter.column, filter.value as any[]);
        break;
      case 'ilike':
        q = q.ilike(filter.column, `%${String(filter.value)}%`);
        break;
      case 'gte':
        q = q.gte(filter.column, filter.value);
        break;
      case 'lte':
        q = q.lte(filter.column, filter.value);
        break;
      case 'gt':
        q = q.gt(filter.column, filter.value);
        break;
      case 'lt':
        q = q.lt(filter.column, filter.value);
        break;
      case 'is_null':
        q = q.is(filter.column, null);
        break;
      case 'not_null':
        q = q.not(filter.column, 'is', null);
        break;
      case 'contains':
        q = q.contains(filter.column, filter.value);
        break;
    }
  }
  return q;
}

/** The scope filter, applied to every single query this tool makes. */
function applyScope(query: any, ownerColumn: string, accountIds: string[] | null | undefined) {
  if (!accountIds || accountIds.length === 0) return query;
  return query.in(ownerColumn, accountIds);
}

function adminClient(): any | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    const { createClient } = require('@supabase/supabase-js');
    return createClient(url, key, { auth: { persistSession: false } });
  } catch {
    return null;
  }
}

interface ScopeContext {
  caller: { id: string; role?: string | null; parent_id?: string | null; agency_id?: string | null };
  children: Array<{ id: string }>;
}

async function loadScopeContext(db: any, userId: string): Promise<ScopeContext> {
  const { data: caller } = await db
    .from('profiles')
    .select('id, role, parent_id, agency_id')
    .eq('id', userId)
    .maybeSingle();

  const base = caller || { id: userId, role: null, parent_id: null, agency_id: null };

  const { data: children } = await db
    .from('profiles')
    .select('id')
    .or(`parent_id.eq.${userId},agency_id.eq.${userId}`);

  return { caller: base as any, children: (children || []) as Array<{ id: string }> };
}

/** Aggregate rows in memory: exact over what was scanned, and it says how much that was. */
export function aggregateRows(
  rows: Array<Record<string, any>>,
  groupBy: string[],
  metrics: Array<{ fn: string; column?: string }>
): Array<Record<string, any>> {
  const buckets = new Map<string, { keys: Record<string, any>; rows: Array<Record<string, any>> }>();

  for (const row of rows) {
    const keys: Record<string, any> = {};
    for (const column of groupBy) keys[column] = row[column] ?? null;
    const key = groupBy.length ? JSON.stringify(groupBy.map((c) => keys[c])) : '__all__';
    if (!buckets.has(key)) buckets.set(key, { keys, rows: [] });
    buckets.get(key)!.rows.push(row);
  }

  const out: Array<Record<string, any>> = [];
  for (const bucket of buckets.values()) {
    const result: Record<string, any> = { ...bucket.keys };
    for (const metric of metrics) {
      const label =
        metric.fn === 'count' ? 'count' : `${metric.fn}_${metric.column}`;
      if (metric.fn === 'count') {
        result[label] = bucket.rows.length;
        continue;
      }
      const values = bucket.rows
        .map((r) => Number(r[metric.column as string]))
        .filter((n) => Number.isFinite(n));
      if (!values.length) {
        result[label] = null;
        continue;
      }
      switch (metric.fn) {
        case 'sum':
          result[label] = Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;
          break;
        case 'avg':
          result[label] = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
          break;
        case 'min':
          result[label] = Math.min(...values);
          break;
        case 'max':
          result[label] = Math.max(...values);
          break;
      }
    }
    out.push(result);
  }

  return out.sort((a, b) => Number(b.count ?? 0) - Number(a.count ?? 0));
}

export function createDataQueryTools(supabase: SupabaseClient, userId: string) {
  const db = (adminClient() || (supabase as any)) as any;

  return {
    query_account_data: tool({
      description:
        'Ask any question of THIS ACCOUNT\'S OWN data, with exact counts. This is the general-purpose read primitive: use it instead of hunting for a tool that happens to answer the question. ' +
        `Operations: count (exact, any size), list (up to ${MAX_LIST_ROWS} rows), aggregate (group by + count/sum/avg/min/max), distinct. ` +
        `Tables: ${QUERYABLE_TABLE_NAMES.join(', ')}. ` +
        'Filters support eq, neq, in, ilike, gte, lte, gt, lt, is_null, not_null, contains — including date ranges like created_at gte 2026-11-01. ' +
        'SCOPE is decided by your role, not by a column: scope "me" (this account), "org" (this account plus the accounts under it — agency/admin only), "all" (the whole platform — super admin only). ' +
        'A user_id filter is refused on purpose. The result always states the scope it used, so quote that scope when you report a number. ' +
        'Prefer this over org_lead_report / org_call_report when the owner asks about THEIR account specifically.',
      inputSchema: z.object({
        table: z.string().describe(`One of: ${QUERYABLE_TABLE_NAMES.join(', ')}`),
        operation: z.enum(['count', 'list', 'aggregate', 'distinct']).describe('What to compute'),
        scope: z
          .enum(['me', 'org', 'all'])
          .default('me')
          .describe('me = this account; org = this account + its sub-accounts; all = platform (super admin only)'),
        columns: z.array(z.string()).optional().describe('Columns to return (list) or read (distinct). Defaults are sensible per operation.'),
        filters: z
          .array(
            z.object({
              column: z.string(),
              op: z.enum(['eq', 'neq', 'in', 'ilike', 'gte', 'lte', 'gt', 'lt', 'is_null', 'not_null', 'contains']),
              value: z.any().optional(),
            })
          )
          .optional()
          .describe('Conditions ANDed together. Discover null with {column, op:"is_null"}; date ranges with gte/lte on created_at.'),
        groupBy: z.array(z.string()).optional().describe('aggregate: the columns to group by'),
        metrics: z
          .array(z.object({ fn: z.enum(['count', 'sum', 'avg', 'min', 'max']), column: z.string().optional() }))
          .optional()
          .describe('aggregate: what to compute per group. Default [{fn:"count"}].'),
        orderBy: z.string().optional().describe('Column to order by (list). Defaults to created_at when the table has it.'),
        ascending: z.boolean().optional().describe('Order direction for list (default false = newest first)'),
        limit: z.number().optional().describe(`list: rows to return (max ${MAX_LIST_ROWS})`),
        offset: z.number().optional().describe('list: rows to skip, for paging'),
      }),
      execute: async (input: any) => {
        try {
          const spec = queryableTable(input.table);
          const validation = validateQuery(input);
          if (!validation.ok) return { ok: false, error: validation.error };
          if (!spec) return { ok: false, error: `"${input.table}" is not queryable` };

          const context = await loadScopeContext(db, userId);
          const scope = resolveScopeFrom(input.scope, context.caller, context.children);
          if (!scope.ok) return { ok: false, error: scope.error };

          const filters = validation.filters || [];
          const ownerColumn = spec.ownerColumn;
          // EVERY query goes through this: filters AND the scope. Live testing caught the first version of
          // this tool returning platform-wide counts because only the scan applied the scope — a "scoped"
          // tool that silently is not scoped is worse than no tool at all.
          const scoped = (q: any) => applyScope(applyFilters(q, filters), ownerColumn, scope.accountIds);
          const base = () => scoped(db.from(input.table).select('*', { count: 'exact', head: true }));

          // ---- count: exact, at any size
          if (input.operation === 'count') {
            const { count, error } = await base();
            if (error) return { ok: false, error: error.message };
            return {
              ok: true,
              table: input.table,
              operation: 'count',
              count: count ?? 0,
              scope: scope.scope,
              scopeLabel: scope.label,
              accountsInScope: scope.accountCount,
              filtersApplied: filters,
              note: 'Exact count — the whole matching set, not a sample.',
            };
          }

          // ---- list
          if (input.operation === 'list') {
            const spec2 = spec;
            const defaultColumns = ['id', 'created_at'].filter((c) => spec2.columns.includes(c));
            const columns = (input.columns?.length ? input.columns : defaultColumns).join(',') || '*';
            const orderColumn =
              input.orderBy || (spec2.columns.includes('created_at') ? 'created_at' : spec2.columns.includes('id') ? 'id' : undefined);
            const limit = Math.max(1, Math.min(Number(input.limit ?? 50), MAX_LIST_ROWS));
            const offset = Math.max(0, Number(input.offset ?? 0));

            let q = db.from(input.table).select(columns, { count: 'exact' });
            q = scoped(q);
            if (orderColumn) q = q.order(orderColumn, { ascending: input.ascending === true });
            q = q.range(offset, offset + limit - 1);

            const { data, error, count } = await q;
            if (error) return { ok: false, error: error.message };
            return {
              ok: true,
              table: input.table,
              operation: 'list',
              rows: data || [],
              returned: (data || []).length,
              totalMatching: count ?? null,
              offset,
              scope: scope.scope,
              scopeLabel: scope.label,
              filtersApplied: filters,
            };
          }

          // ---- distinct
          if (input.operation === 'distinct') {
            const column = (input.columns || [])[0] || input.groupBy?.[0];
            if (!column) return { ok: false, error: 'distinct needs one column in `columns`' };
            const scan = await scanRows(db, input.table, [column], filters, scope, MAX_SCAN_ROWS);
            const counts = new Map<string, number>();
            for (const row of scan.rows) {
              const value = row[column];
              const key = value === null || value === undefined ? '(null)' : String(value);
              counts.set(key, (counts.get(key) || 0) + 1);
            }
            const values = [...counts.entries()]
              .map(([value, count]) => ({ value, count }))
              .sort((a, b) => b.count - a.count);
            return {
              ok: true,
              table: input.table,
              operation: 'distinct',
              column,
              distinctCount: values.length,
              values: values.slice(0, 100),
              scanned: scan.scanned,
              capped: scan.capped,
              scope: scope.scope,
              scopeLabel: scope.label,
              note: scan.capped
                ? `Only the first ${MAX_SCAN_ROWS} matching rows were scanned, so these are the values in that slice, not necessarily every value. Use operation "count" with a filter to get an exact number for one value.`
                : 'Every matching row was scanned.',
            };
          }

          // ---- aggregate
          const groupBy = input.groupBy?.length ? input.groupBy : [];
          const metrics = input.metrics?.length ? input.metrics : [{ fn: 'count' as const }];
          const needed = [...new Set([...groupBy, ...metrics.map((m: any) => m.column).filter(Boolean)])];
          if (!needed.length) needed.push(spec.columns.includes('id') ? 'id' : spec.columns[0]);

          const scan = await scanRows(db, input.table, needed, filters, scope, MAX_SCAN_ROWS);
          const groups = aggregateRows(scan.rows, groupBy, metrics);

          // The exact total is a separate head-count, so a capped scan can never be mistaken for one.
          const { count: exactTotal } = await base();

          return {
            ok: true,
            table: input.table,
            operation: 'aggregate',
            groupBy,
            metrics,
            groups: groups.slice(0, 200),
            groupCount: groups.length,
            scanned: scan.scanned,
            capped: scan.capped,
            exactTotalMatching: exactTotal ?? null,
            scope: scope.scope,
            scopeLabel: scope.label,
            accountsInScope: scope.accountCount,
            filtersApplied: filters,
            note: scan.capped
              ? `The scan stopped at ${MAX_SCAN_ROWS} rows, so group metrics are for that slice. exactTotalMatching IS exact for all matching rows — use it for a headline number, or filters to narrow.`
              : 'Every matching row was scanned, so these are exact group metrics.',
          };
        } catch (e: any) {
          return { ok: false, error: e?.message || 'the query failed' };
        }
      },
    }),
  };
}

/** Page through matching rows for a scan, with the scope applied on every page. */
async function scanRows(
  db: any,
  table: string,
  columns: string[],
  filters: FilterSpec[],
  scope: ScopeResolution,
  cap: number
): Promise<{ rows: Array<Record<string, any>>; scanned: number; capped: boolean }> {
  const spec = queryableTable(table);
  const rows: Array<Record<string, any>> = [];
  let offset = 0;
  let capped = false;

  while (offset < cap) {
    let q = db.from(table).select(columns.join(','));
    q = applyFilters(q, filters);
    q = applyScope(q, spec?.ownerColumn || 'user_id', scope.accountIds);
    q = q.range(offset, Math.min(offset + SCAN_PAGE - 1, cap - 1));

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const page = (data || []) as Array<Record<string, any>>;
    rows.push(...page);
    if (page.length < SCAN_PAGE) break;
    offset += SCAN_PAGE;
    if (offset >= cap) capped = true;
  }

  return { rows, scanned: rows.length, capped };
}

/** Names this module registers, so a gate can assert they are wired. */
export const DATA_QUERY_TOOLS = ['query_account_data'] as const;
