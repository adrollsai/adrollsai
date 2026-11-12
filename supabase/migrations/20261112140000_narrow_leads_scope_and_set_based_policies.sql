-- ============================================================================
-- 20261112140000_narrow_leads_scope_and_set_based_policies.sql
--
-- Two things, both in service of the same goal: correct + fast tenant scoping.
--
-- (1) CORRECTION to 20261112120000.
--     That migration replaced the original `leads` policies with
--     `is_same_tenant(user_id)`. That model is broader than the `leads` policy
--     it replaced, and an exhaustive check over all 94 profiles confirmed it
--     widened real access:
--
--         test2@fraction.com           0 -> 3709 leads
--         ruleschd@gmail.com           0 -> 3709
--         agent@demo.com               0 -> 3709
--         rahul@test.com               0 -> 3709
--         rahulchopra.dev@gmail.com    0 -> 3709
--         test-agent@gmail.com         0 -> 3709
--         punitpalsingh81@gmail.com 2217 -> 3709
--         ihomcomrealtors@gmail.com  449 ->  457
--
--     The extra rows came from two branches `leads` never had: "owner is a
--     profile whose parent_id = me" and "owner shares my organization_id".
--     Those branches are correct for the tables 20261111150100 scoped, but for
--     `leads` they leak another workspace's leads. This migration restores the
--     ORIGINAL `leads` visibility exactly (same owner set, verified 0
--     differences across all 94 profiles) while still avoiding the per-row
--     `profiles` re-read that caused the outage.
--
-- (2) SET-BASED TENANT HELPER.
--     `is_same_tenant(user_id)` is a scalar function, so Postgres cannot hoist
--     it out of the scan: it runs once per candidate row, and each call does
--     two `profiles` lookups. On `lead_history` (117k rows, 96k visible) that
--     measured 3.4s against an 8s statement_timeout.
--
--     `public.my_tenant_ids()` returns the same tenant set as a SETOF. Used as
--     `user_id IN (SELECT * FROM public.my_tenant_ids())` the subquery is
--     uncorrelated, so the planner turns it into a hashed SubPlan evaluated
--     ONCE per query and each row becomes a hash lookup.
--
--     Semantics are identical to is_same_tenant() by construction - the same
--     five branches - and are verified row-for-row over every (caller, owner)
--     pair in the database.
--
-- Both helpers are SECURITY DEFINER, so they read `profiles` without
-- re-entering `profiles_select_policy` (the recursion/expense trap).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Tenant set == is_same_tenant() semantics, as a set
-- ---------------------------------------------------------------------------
create or replace function public.my_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with me as (
    select p.id, p.parent_id, p.agency_id, p.organization_id, p.role
    from public.profiles p
    where p.id = auth.uid()
  )
  select m.id from me m
  union
  select m.parent_id from me m where m.parent_id is not null
  union
  select m.agency_id from me m where m.agency_id is not null
  union
  select c.id
  from public.profiles c, me m
  where c.parent_id = m.id
     or c.agency_id = m.id
     or (c.organization_id is not null and c.organization_id = m.organization_id)
  union
  select p.id from public.profiles p, me m where m.role = 'super_admin'
$$;

-- ---------------------------------------------------------------------------
-- 2. Lead-owner set == the ORIGINAL leads policy semantics, as a set.
--    Deliberately NARROWER than my_tenant_ids(): no organization branch and no
--    "owner.parent_id = me" branch, because the leads policy never had them.
-- ---------------------------------------------------------------------------
create or replace function public.lead_owner_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with me as (
    select p.id, p.parent_id, p.agency_id, p.role
    from public.profiles p
    where p.id = auth.uid()
  )
  select m.id from me m
  union
  select m.parent_id from me m where m.parent_id is not null
  union
  select m.agency_id from me m where m.agency_id is not null
  union
  select c.id from public.profiles c, me m where c.agency_id = m.id
  union
  select p.id from public.profiles p, me m where m.role = 'super_admin'
$$;

-- ---------------------------------------------------------------------------
-- 3. leads: original scope, set-based (no widening, no per-row profiles read)
-- ---------------------------------------------------------------------------
drop policy if exists "Users and staff can view leads" on public.leads;
create policy "Users and staff can view leads" on public.leads
  for select to authenticated
  using (
    auth.uid() = assigned_to
    or user_id in (select * from public.lead_owner_ids())
  );

drop policy if exists "Users and staff can update leads" on public.leads;
create policy "Users and staff can update leads" on public.leads
  for update to authenticated
  using (
    auth.uid() = assigned_to
    or user_id in (select * from public.lead_owner_ids())
  );

-- ---------------------------------------------------------------------------
-- 4. lead_history / notifications: unchanged tenant model, set-based
--    (these are the two large tables where the scalar helper dominated)
-- ---------------------------------------------------------------------------
drop policy if exists "tenant_isolation" on public.lead_history;
create policy "tenant_isolation" on public.lead_history
  for all to authenticated
  using (user_id in (select * from public.my_tenant_ids()))
  with check (user_id in (select * from public.my_tenant_ids()));

drop policy if exists "tenant_isolation" on public.notifications;
create policy "tenant_isolation" on public.notifications
  for all to authenticated
  using (user_id in (select * from public.my_tenant_ids()))
  with check (user_id in (select * from public.my_tenant_ids()));

analyze public.leads;
analyze public.lead_history;
analyze public.notifications;

commit;
