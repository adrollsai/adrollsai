/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase rows are untyped. */
/**
 * The scoped WRITE primitive: change this account's own rows, safely.
 *
 * WHY THIS EXISTS
 * Reads got a primitive (`query_account_data`) because the reporting tools only answered questions
 * someone had anticipated. Writes have the same problem from the other side: the agent can move ONE
 * lead's stage (`crm_update_lead_stage`), add ONE catalogue item, send ONE template — so "set every
 * Diwali lead that is still New to Contacted" became hundreds of single-row tool calls, or a polite
 * refusal. Flexibility means the agent can express the operation it means, once.
 *
 * THE FOUR GUARDS THAT MAKE IT SAFE
 *  1. SCOPE IS NOT AN INPUT. The account filter is taken from the caller's role, exactly as the read
 *     primitive does it. A `user_id` may not be written or filtered on, ever.
 *  2. NO UNFILTERED MUTATION. update/delete must carry at least one filter, so "everything in the
 *     table" is not expressible by accident. An empty filter list is refused with the reason.
 *  3. TWO PHASES, DRY BY DEFAULT. The first call describes what WOULD change (match count + sample
 *     rows) and writes nothing. Writing requires `apply: true`, and a batch is capped, so a broad
 *     change has to be acknowledged rather than discovered afterwards.
 *  4. DELETE IS REVIEW-GATED (see REVIEW_POLICY): destroying rows needs a human, and the card carries
 *     the exact filters. Updates and inserts are not gated — they are reversible, and a tenant
 *     editing its own data is the whole point — but every write leaves a trail: lead changes go to
 *     `lead_history` the way the CRM's own writes do.
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

import { QUERYABLE_TABLE_NAMES, queryableTable } from '../data/column-map';
import { resolveScopeFrom, type FilterSpec } from './data-query';

/** Rows one apply may touch. A broad change has to be batched and reported, not silent. */
export const MAX_WRITE_ROWS = 200;
/** Rows one insert call may create. */
export const MAX_INSERT_ROWS = 25;
/** Columns that belong to the platform, not to the caller. */
const SYSTEM_COLUMNS = ['id', 'created_at', 'updated_at', 'user_id', 'owner_id', 'organization_id', 'profile_id'];
/** Never writeable through this tool, whatever the table. */
const FORBIDDEN_WRITE_COLUMNS = ['voice_call_id', 'credits', 'calling_credits', 'subscription_status', 'role'];

export interface WriteValidation {
  ok: boolean;
  error?: string;
  filters?: FilterSpec[];
  values?: Record<string, unknown>;
}

/**
 * Validate an update. Pure, so every refusal below is testable without a database.
 */
export function validateUpdate(table: string, filters: FilterSpec[] | undefined, values: Record<string, unknown> | undefined): WriteValidation {
  const spec = queryableTable(table);
  if (!spec) {
    return { ok: false, error: `"${table}" is not a table this tool can write to. Available: ${QUERYABLE_TABLE_NAMES.join(', ')}.` };
  }
  if (!filters || filters.length === 0) {
    return {
      ok: false,
      error:
        'an update needs at least one filter, so "every row in the table" cannot be expressed by accident. ' +
        'Give filters describing exactly the rows you mean (e.g. pipeline_stage eq "New Lead" AND campaign_id eq "..." for this account).',
    };
  }
  if (!values || Object.keys(values).length === 0) {
    return { ok: false, error: 'nothing to update: supply at least one column and value' };
  }

  const cleanValues: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(values)) {
    if (FORBIDDEN_WRITE_COLUMNS.includes(column)) {
      return { ok: false, error: `"${column}" cannot be written here: it is billing or identity, not a business field.` };
    }
    if (SYSTEM_COLUMNS.includes(column)) {
      return { ok: false, error: `"${column}" is owned by the platform and cannot be written.` };
    }
    if (!spec.columns.includes(column)) {
      return { ok: false, error: `"${column}" is not a column on ${table}.` };
    }
    cleanValues[column] = value;
  }

  const cleanedFilters: FilterSpec[] = [];
  for (const filter of filters) {
    if (['user_id', 'owner_id', 'profile_id'].includes(filter.column)) {
      return { ok: false, error: `"${filter.column}" is the scope column and cannot be filtered on: the tool applies the scope.` };
    }
    if (!spec.columns.includes(filter.column)) {
      return { ok: false, error: `cannot filter on "${filter.column}": not a column on ${table}` };
    }
    if (filter.op === 'is_null' || filter.op === 'not_null') {
      cleanedFilters.push(filter);
      continue;
    }
    if (filter.value === undefined || filter.value === null || filter.value === '') {
      return { ok: false, error: `"${filter.op}" on "${filter.column}" needs a value` };
    }
    cleanedFilters.push(filter);
  }

  return { ok: true, filters: cleanedFilters, values: cleanValues };
}

/** Validate an insert. Pure. */
export function validateInsert(table: string, rows: Array<Record<string, unknown>> | undefined): WriteValidation {
  const spec = queryableTable(table);
  if (!spec) {
    return { ok: false, error: `"${table}" is not a table this tool can write to.` };
  }
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: 'nothing to insert: supply at least one row' };
  if (rows.length > MAX_INSERT_ROWS) {
    return { ok: false, error: `at most ${MAX_INSERT_ROWS} rows per insert (got ${rows.length}); split the work` };
  }

  const cleaned = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(row || {})) {
      if (SYSTEM_COLUMNS.includes(column) || FORBIDDEN_WRITE_COLUMNS.includes(column)) continue;
      if (!spec.columns.includes(column)) continue;
      out[column] = value;
    }
    return out;
  });

  if (cleaned.some((row) => Object.keys(row).length === 0)) {
    return { ok: false, error: 'a row had no usable columns: check the column names against the table' };
  }
  return { ok: true, values: cleaned as any };
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

export function createDataWriteTools(supabase: SupabaseClient, userId: string) {
  const db = (adminClient() || (supabase as any)) as any;

  const scopeFor = async (requested: string | undefined, accountId?: string) => {
    const { data: caller } = await db.from('profiles').select('id, role, parent_id, agency_id').eq('id', userId).maybeSingle();
    const { data: children } = await db.from('profiles').select('id').or(`parent_id.eq.${userId},agency_id.eq.${userId}`);
    const resolved = resolveScopeFrom(requested, (caller || { id: userId }) as any, (children || []) as any);

    if (!resolved.ok) return resolved;

    const isSuperAdmin = String((caller as any)?.role ?? '').toLowerCase() === 'super_admin';

    // A super admin may write to ANY named account — that is what super admin means, and it is how a
    // client account that is not in the caller's subtree (GNR HOMES is one) can be helped at all.
    if (accountId && isSuperAdmin) {
      return { ...resolved, accountIds: [accountId], accountCount: 1, label: `account ${accountId} (as super admin)` };
    }

    // A write targets ONE account. With an org/all scope the caller must name which account.
    if (accountId) {
      if (resolved.accountIds && !resolved.accountIds.includes(accountId)) {
        return { ok: false as const, error: `account "${accountId}" is outside the scope you may write to (${resolved.label})` };
      }
      return { ...resolved, accountIds: [accountId], accountCount: 1, label: `account ${accountId}` };
    }
    if (!resolved.accountIds || resolved.accountIds.length !== 1) {
      return {
        ok: false as const,
        error:
          'a write targets one account: pass accountId (from query_account_data with scope "org"/"all") so it is unambiguous ' +
          'which account is being changed.',
      };
    }
    return resolved;
  };

  return {
    update_account_data: tool({
      description:
        'CHANGE this account\'s own rows — the write counterpart of query_account_data. Operations: update (set columns on matching rows), insert (create rows), delete (remove rows that match). ' +
        'It is DRY BY DEFAULT: the first call reports how many rows match and shows samples, and writes nothing. Call it again with apply:true to make the change, and it will refuse silently-broad edits because at most ' +
        `${MAX_WRITE_ROWS} rows are touched per call (batch the rest). update/delete REQUIRE filters — "every row" is not expressible. ` +
        'Deleting needs the owner\'s approval (review card). Scope is decided by your role, not by a column, and a user_id can never be written or filtered on. ' +
        'For a single lead prefer crm_update_lead_stage / crm_update_lead, which also write the CRM history trail; use this when you need the operation the narrow tool does not offer.',
      inputSchema: z.object({
        table: z.string().describe(`One of: ${QUERYABLE_TABLE_NAMES.join(', ')}`),
        operation: z.enum(['update', 'insert', 'delete']),
        scope: z.enum(['me', 'org', 'all']).default('me').describe('me = this account (default). org/all need the role and an explicit accountId.'),
        accountId: z.string().optional().describe('Which account to write when the scope covers more than one'),
        filters: z
          .array(
            z.object({
              column: z.string(),
              op: z.enum(['eq', 'neq', 'in', 'ilike', 'gte', 'lte', 'gt', 'lt', 'is_null', 'not_null', 'contains']),
              value: z.any().optional(),
            })
          )
          .optional()
          .describe('REQUIRED for update and delete: exactly which rows'),
        values: z.record(z.string(), z.any()).optional().describe('update: { column: newValue }'),
        rows: z.array(z.record(z.string(), z.any())).optional().describe(`insert: 1-${MAX_INSERT_ROWS} rows`),
        apply: z.boolean().default(false).describe('false = preview only (default). true = actually write.'),
        reason: z.string().optional().describe('One sentence for the trail on why this change is being made'),
      }),
      execute: async (input: any) => {
        try {
          const scope = await scopeFor(input.scope, input.accountId);
          if (!scope.ok) return { ok: false, error: scope.error };
          const accountIds = scope.accountIds as string[];
          const accountId = accountIds[0];
          const spec = queryableTable(input.table);
          if (!spec) return { ok: false, error: `"${input.table}" is not writeable through this tool.` };

          // ---- insert
          if (input.operation === 'insert') {
            const validation = validateInsert(input.table, input.rows);
            if (!validation.ok) return { ok: false, error: validation.error };
            const prepared = (validation.values as any as Array<Record<string, unknown>>).map((row) => ({
              ...row,
              [spec.ownerColumn]: accountId,
            }));
            if (!input.apply) {
              return {
                ok: true,
                dryRun: true,
                operation: 'insert',
                wouldInsert: prepared.length,
                preview: prepared.slice(0, 5),
                scope: scope.scope,
                note: `Nothing written. Call again with apply:true to create ${prepared.length} row(s).`,
              };
            }
            const { data, error } = await db.from(input.table).insert(prepared).select();
            if (error) return { ok: false, error: error.message };
            return {
              ok: true,
              operation: 'insert',
              inserted: (data || []).length,
              rows: (data || []).slice(0, 10),
              scope: scope.scope,
              reason: input.reason || null,
            };
          }

          // ---- update / delete both need filters
          const validated = validateUpdate(input.table, input.filters, input.operation === 'update' ? input.values : { __probe: true } as any);
          const filters = validated.filters;
          if (!filters) return { ok: false, error: validated.error };
          if (input.operation === 'update' && !validated.ok) return { ok: false, error: validated.error };

          const matching = () => {
            let q = db.from(input.table).select('*', { count: 'exact', head: true });
            q = applyFilters(q, filters);
            return q.in(spec.ownerColumn, accountIds);
          };

          const { count, error: countErr } = await matching();
          if (countErr) return { ok: false, error: countErr.message };
          const matched = count ?? 0;

          if (matched === 0) {
            return { ok: false, error: 'no rows match those filters, so nothing would change. Check the filters with query_account_data first.' };
          }
          if (matched > MAX_WRITE_ROWS) {
            return {
              ok: false,
              error:
                `${matched} rows match, which is over the ${MAX_WRITE_ROWS}-row cap for one call. ` +
                'Narrow the filters (add a date range or a stage) and run it in batches — nothing was changed.',
              matched,
            };
          }

          // ---- the preview
          if (!input.apply) {
            let sampleQuery = db.from(input.table).select('*');
            sampleQuery = applyFilters(sampleQuery, filters);
            const { data: sample } = await sampleQuery.in(spec.ownerColumn, accountIds).limit(5);
            return {
              ok: true,
              dryRun: true,
              operation: input.operation,
              matched,
              preview: (sample || []).map((row: any) => {
                const pick: Record<string, any> = {};
                const keep = input.operation === 'update' ? Object.keys(input.values || {}) : [];
                for (const column of ['id', 'name', 'phone', 'pipeline_stage', ...keep]) {
                  if (column in row) pick[column] = row[column];
                }
                return pick;
              }),
              wouldSet: input.operation === 'update' ? validated.values : undefined,
              scope: scope.scope,
              note:
                `Nothing written. ${matched} row(s) match. Re-run with apply:true to change them` +
                (input.operation === 'delete' ? ' (deleting also needs the owner\'s approval first).' : '.'),
            };
          }

          // ---- apply
          if (input.operation === 'update') {
            let q = db.from(input.table).update(validated.values as any);
            q = applyFilters(q, filters);
            const { data, error } = await q.in(spec.ownerColumn, accountIds).select('id');
            if (error) return { ok: false, error: error.message };

            // The trail: a lead change writes history the way the CRM's own writes do.
            if (input.table === 'leads') {
              try {
                const changed = Object.keys(validated.values as any).map((c) => `${c} = ${JSON.stringify((validated.values as any)[c])}`).join(', ');
                await db.from('lead_history').insert(
                  (data || []).slice(0, MAX_WRITE_ROWS).map((row: any) => ({
                    lead_id: row.id,
                    user_id: accountId,
                    action_type: 'REMARK',
                    description: `Agent bulk update: ${changed}${input.reason ? ` — ${input.reason}` : ''}`,
                  }))
                );
              } catch {
                /* the trail is best effort; the change already happened */
              }
            }

            return {
              ok: true,
              operation: 'update',
              updated: (data || []).length,
              values: validated.values,
              filtersApplied: filters,
              scope: scope.scope,
              reason: input.reason || null,
            };
          }

          // delete
          let q = db.from(input.table).delete();
          q = applyFilters(q, filters);
          const { data, error } = await q.in(spec.ownerColumn, accountIds).select('id');
          if (error) return { ok: false, error: error.message };
          return {
            ok: true,
            operation: 'delete',
            deleted: (data || []).length,
            filtersApplied: filters,
            scope: scope.scope,
            reason: input.reason || null,
          };
        } catch (e: any) {
          return { ok: false, error: e?.message || 'the write failed; nothing was committed' };
        }
      },
    }),
  };
}

/** Names this module registers, so a gate can assert they are wired. */
export const DATA_WRITE_TOOLS = ['update_account_data'] as const;
