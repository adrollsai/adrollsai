/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase rows are untyped. */
/**
 * The account directory: find a client account, and know what is in it.
 *
 * THE GAP THIS FILLS
 * The owner (super admin) asked for "GNR Homes' leads from its latest campaign". The agent could not
 * find GNR Homes at all: GNR HOMES exists in `profiles` (role admin, no parent, no agency) and has
 * leads, but there was no way to (a) look an account up by name, or (b) ask "the data for THAT
 * account". `query_account_data` only had me / org / all — and "org" is the caller's own subtree, which
 * an independent client account is not part of. So the honest answer to the owner's question was
 * "I cannot see it", for an account they own.
 *
 * SCOPE, same rule as everywhere else in this codebase — decided by role in code:
 *   super_admin  every account on the platform
 *   agency       itself plus the accounts linked under it
 *   everyone     itself
 *
 * `latest_campaign` comes back with each account because that is the next question ("…from its latest
 * campaign"), and asking it separately used to mean a second guess at which campaign was newest.
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

import { exactCount } from '@/lib/supabase/paged';

export interface AccountScope {
  ok: boolean;
  error?: string;
  mode: 'all' | 'org' | 'me';
  /** Account ids this caller may look at. `null` means every account. */
  allowedIds: string[] | null;
}

/**
 * Which accounts may this caller see? Pure, so the rule is testable without a database.
 *
 * A tenant sees itself. An account with linked sub-accounts (or an agency) sees its own tree. Only a
 * super_admin sees the whole platform — and the caller is told which of those applied, because that
 * is the sentence they need when they quote a number.
 */
export function resolveAccountScope(
  caller: { id: string; role?: string | null },
  children: Array<{ id: string }> = []
): AccountScope {
  const role = String(caller.role ?? '').toLowerCase();
  if (role === 'super_admin') return { ok: true, mode: 'all', allowedIds: null };

  const childIds = (children || []).map((c) => String(c.id)).filter(Boolean);
  if (role === 'agency' || childIds.length > 0) {
    return { ok: true, mode: 'org', allowedIds: [...new Set([caller.id, ...childIds])] };
  }
  return { ok: true, mode: 'me', allowedIds: [caller.id] };
}

/** Is this account inside the caller's scope? Pure. */
export function accountIsVisible(scope: AccountScope, accountId: string): boolean {
  if (!scope.ok) return false;
  if (scope.allowedIds === null) return true;
  return scope.allowedIds.includes(String(accountId));
}

export interface AccountRow {
  id: string;
  business_name: string | null;
  email: string | null;
  role: string | null;
  parent_id: string | null;
  agency_id: string | null;
}

/** Does this account match the search text? Pure — name, email or id fragment. */
export function accountMatches(row: AccountRow, search: string): boolean {
  const needle = String(search ?? '').trim().toLowerCase();
  if (!needle) return true;
  // "GNR Homes" must match "GNR HOMES" and "gnrhomes97@gmail.com" — normalise whitespace and case,
  // and also test the needle with its spaces removed against the same.
  const compact = needle.replace(/\s+/g, '');
  const fields = [row.business_name, row.email, row.id].map((v) => String(v ?? '').toLowerCase());
  return fields.some((field) => field.includes(needle) || field.replace(/\s+/g, '').includes(compact));
}

export function createAccountTools(supabase: SupabaseClient, userId: string) {
  const db = supabase as any;

  const loadScope = async (): Promise<AccountScope & { caller?: any }> => {
    const { data: caller } = await db.from('profiles').select('id, role').eq('id', userId).maybeSingle();
    const { data: children } = await db.from('profiles').select('id').or(`parent_id.eq.${userId},agency_id.eq.${userId}`);
    const scope = resolveAccountScope((caller || { id: userId }) as any, (children || []) as any);
    return { ...scope, caller };
  };

  return {
    list_accounts: tool({
      description:
        'Find a client / business ACCOUNT by name, and see what is in it. Use this whenever the owner names a business ("for GNR Homes", "my client ProEstate") — it returns the account id, its latest campaign and how many leads it has, which is exactly what is needed to then read that account\'s data. ' +
        'Scope follows your role: a super admin sees every account on the platform, an agency sees its own sub-accounts, a tenant sees only itself. It also tells you which of those applied.',
      inputSchema: z.object({
        search: z.string().optional().describe('Business name, email or id fragment, e.g. "GNR"'),
        role: z.enum(['client', 'agent', 'admin', 'agency', 'super_admin']).optional().describe('Filter by account role'),
        limit: z.number().default(20).describe('Max accounts to return (1-50)'),
        withStats: z.boolean().default(true).describe('Include lead counts and the latest campaign for each account'),
      }),
      execute: async (input: any) => {
        try {
          const scope = await loadScope();
          if (!scope.ok) return { ok: false, error: scope.error };

          let q = db.from('profiles').select('id, business_name, email, role, parent_id, agency_id');
          if (scope.allowedIds !== null) q = q.in('id', scope.allowedIds);
          if (input.role) q = q.eq('role', input.role);
          const { data, error } = await q.limit(500);
          if (error) return { ok: false, error: error.message };

          const matched = ((data || []) as AccountRow[]).filter((row) => accountMatches(row, input.search));
          const limit = Math.max(1, Math.min(Number(input.limit ?? 20), 50));
          const page = matched.slice(0, limit);

          const accounts = [];
          for (const row of page) {
            const entry: Record<string, any> = {
              id: row.id,
              businessName: row.business_name,
              email: row.email,
              role: row.role,
              parentId: row.parent_id,
              agencyId: row.agency_id,
            };

            if (input.withStats !== false) {
              const { count: leadCount } = await db.from('leads').select('id', { count: 'exact', head: true }).eq('user_id', row.id);
              entry.leads = leadCount ?? 0;

              const { data: campaigns } = await db
                .from('campaigns')
                .select('id, name, created_at, status')
                .eq('user_id', row.id)
                .order('created_at', { ascending: false })
                .limit(1);
              const latest = (campaigns || [])[0];
              if (latest) {
                const { count: campaignLeads } = await db
                  .from('leads')
                  .select('id', { count: 'exact', head: true })
                  .eq('user_id', row.id)
                  .eq('campaign_id', latest.id);
                entry.latestCampaign = {
                  id: latest.id,
                  name: latest.name,
                  createdAt: latest.created_at,
                  status: latest.status ?? null,
                  leads: campaignLeads ?? 0,
                  source: 'campaigns table',
                };
              } else {
                // NO CAMPAIGN ROWS, BUT THE LEADS KNOW.
                //
                // GNR HOMES is exactly this case: `campaigns` is empty for the account, yet its leads
                // carry `ad_name` and `campaign_id` from Meta ("GNR Homes - Tricity Luxury … - High
                // Intent (15/11/2026)"). Answering "no campaign" there would be wrong; the latest
                // campaign is the attribution on the newest lead that has one.
                const { data: newestAttributed } = await db
                  .from('leads')
                  .select('ad_name, campaign_id, created_at')
                  .eq('user_id', row.id)
                  .not('ad_name', 'is', null)
                  .order('created_at', { ascending: false })
                  .limit(1);

                const newest = (newestAttributed || [])[0];
                if (newest?.ad_name) {
                  const { count: attributedLeads } = await db
                    .from('leads')
                    .select('id', { count: 'exact', head: true })
                    .eq('user_id', row.id)
                    .eq('ad_name', newest.ad_name);
                  entry.latestCampaign = {
                    id: newest.campaign_id ?? null,
                    name: newest.ad_name,
                    createdAt: newest.created_at,
                    leads: attributedLeads ?? 0,
                    source:
                      'lead attribution — this account has no rows in the campaigns table, so the latest campaign is the ad on its newest attributed lead',
                  };
                } else {
                  entry.latestCampaign = null;
                }
              }

              // Which of the recent arrivals are actually theirs, when there is no campaign record.
              const { count: last30 } = await db
                .from('leads')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', row.id)
                .gte('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString());
              entry.leadsLast30Days = last30 ?? 0;
            }

            accounts.push(entry);
          }

          return {
            ok: true,
            scope: scope.mode,
            scopeLabel:
              scope.mode === 'all'
                ? 'every account on the platform (super admin)'
                : scope.mode === 'org'
                  ? `this account plus the accounts linked under it (${scope.allowedIds?.length ?? 0})`
                  : 'this account only',
            searchedIn: (data || []).length,
            matched: matched.length,
            returned: accounts.length,
            accounts,
            next:
              accounts.length === 1
                ? `Use query_account_data with accountId "${accounts[0].id}" to read that account's rows (e.g. table "leads", filters for its latest campaign id).`
                : undefined,
          };
        } catch (e: any) {
          return { ok: false, error: e?.message || 'could not list accounts' };
        }
      },
    }),
  };
}

/** Names this module registers, so a gate can assert they are wired. */
export const ACCOUNT_TOOLS = ['list_accounts'] as const;

/** Exact lead count for one account — exported so the gate can compare it with the tool's answer. */
export async function accountLeadCount(db: any, accountId: string): Promise<number | null> {
  const { count } = await exactCount(() => db.from('leads').select('*', { count: 'exact', head: true }).eq('user_id', accountId));
  return count;
}
