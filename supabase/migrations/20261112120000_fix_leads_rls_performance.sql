-- ============================================================================
-- 20261112120000_fix_leads_rls_performance.sql
--
-- REGRESSION FIX. CRM leads stopped loading for large tenants on 2026-11-11,
-- immediately after 20261111150100_security_tenant_isolation.sql.
--
-- WHAT HAPPENED
--   20261111150100 tightened `profiles` from a permissive policy to
--     using (id = auth.uid() or public.is_same_tenant(id))
--   That was correct for security. But the pre-existing `leads` policies
--   (20260528064000) express tenant scope as two *correlated* subqueries
--   against `profiles`:
--     exists (select 1 from profiles
--              where profiles.id = auth.uid()
--                and (profiles.agency_id = leads.user_id
--                     or profiles.parent_id = leads.user_id
--                     or profiles.role = 'super_admin'))
--     exists (select 1 from profiles
--              where profiles.id = leads.user_id
--                and profiles.agency_id = auth.uid())
--   A subquery inside a policy is itself subject to the RLS of the table it
--   reads. So every candidate lead row now ran `profiles_select_policy`,
--   which ran is_same_tenant(), which ran up to five more subselects against
--   `profiles`. Cost per lead row went from ~0 to ~0.5-1 ms.
--
--   Bluesquare Infra has 16,251 visible leads, so the CRM's count query and
--   its first-page query blew past the `authenticated` role's 8 s
--   statement_timeout (supabase default). PostgREST returns 57014, the page's
--   `firstPageRes.data` is null, and the CRM renders an empty table with no
--   error. Measured: 129 ms with RLS bypassed vs >8 s timeout with RLS on.
--   Same query after this migration: 766 ms.
--
-- WHAT THIS DOES
--   1. is_same_tenant() now resolves the caller and the owner with two
--      primary-key lookups instead of up to five subqueries. Semantics are
--      unchanged: self, my parent, my agency, super_admin, my staff/clients,
--      same organization. It stays SECURITY DEFINER, so it never re-enters RLS.
--   2. The `leads` SELECT and UPDATE policies call that one helper instead of
--      re-querying `profiles`, which removes the nested RLS evaluation.
--      Authorisation is not widened - is_same_tenant(user_id) is exactly the
--      tenant relation the old EXISTS pair was approximating.
--   3. Adds the indexes the CRM's workspace filter and ordering actually need.
--      `assigned_to` had no index at all, and every CRM query filters on
--      `user_id`/`assigned_to` then orders by created_at desc.
--
-- INSERT and DELETE policies are deliberately left untouched: they evaluate
-- per target row, never in bulk, and DELETE has a hand-tuned
-- "super_admin AND NOT agent" clause that must not be disturbed.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Cheaper tenant helper (same semantics, 2 PK lookups)
-- ---------------------------------------------------------------------------
create or replace function public.is_same_tenant(owner_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    with me as (
      select p.id, p.parent_id, p.agency_id, p.organization_id, p.role
      from public.profiles p
      where p.id = auth.uid()
    ),
    owns as (
      select p.id, p.parent_id, p.agency_id, p.organization_id
      from public.profiles p
      where p.id = owner_id
    )
    select
      owner_id is not null
      and auth.uid() is not null
      and (
        owner_id = (select id from me)
        or owner_id = (select parent_id from me)
        or owner_id = (select agency_id from me)
        or (select role from me) = 'super_admin'
        or exists (
          select 1
          from owns o, me m
          where o.parent_id = m.id
             or o.agency_id = m.id
             or (o.organization_id is not null
                 and o.organization_id = m.organization_id)
        )
      )
  ), false)
$$;

-- ---------------------------------------------------------------------------
-- 2. leads: one helper call per row instead of two RLS-filtered EXISTS
-- ---------------------------------------------------------------------------
drop policy if exists "Users and staff can view leads" on public.leads;
create policy "Users and staff can view leads" on public.leads
  for select to authenticated
  using (
    auth.uid() = user_id
    or auth.uid() = assigned_to
    or public.is_same_tenant(user_id)
  );

drop policy if exists "Users and staff can update leads" on public.leads;
create policy "Users and staff can update leads" on public.leads
  for update to authenticated
  using (
    auth.uid() = user_id
    or auth.uid() = assigned_to
    or public.is_same_tenant(user_id)
  );

-- ---------------------------------------------------------------------------
-- 3. Indexes for the CRM workspace filter + created_at ordering
-- ---------------------------------------------------------------------------
create index if not exists idx_leads_assigned_to
  on public.leads (assigned_to);
create index if not exists idx_leads_user_created_at
  on public.leads (user_id, created_at desc);
create index if not exists idx_leads_assigned_created_at
  on public.leads (assigned_to, created_at desc);

-- Plan cache would otherwise keep the expensive plans around.
analyze public.leads;

commit;
