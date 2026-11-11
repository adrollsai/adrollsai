-- ============================================================================
-- 20261111150200_security_tenant_isolation_followup.sql
--
-- Closes the three tables that still carried a permissive `USING (true)`
-- policy after 20261111150100, because they have no `user_id` column and needed
-- to be scoped through a relation instead.
--
--   fractions        -> property_id -> properties (RLS on properties does the
--                       tenant filtering for the EXISTS subquery)
--   creative_prompts -> property_id / organization_id
--   distribution_batches -> a leftover copy-paste policy named
--                       "organizations_all_policy" was created ON THIS TABLE by
--                       20260630000400. It granted full read/write to every
--                       authenticated user despite the name.
--
-- `ads` is deliberately left permissive: it has no tenant column at all
-- (id, created_at, title, description, price, image_url), so it carries no
-- tenant-identifying data. anon cannot reach it (no grant).
-- ============================================================================

begin;

-- fractions
drop policy if exists "fractions_all_policy" on public.fractions;
drop policy if exists "fractions_select_policy" on public.fractions;
drop policy if exists "fractions_tenant" on public.fractions;
create policy "fractions_tenant" on public.fractions
  for all to authenticated
  using (exists (select 1 from public.properties p where p.id = fractions.property_id))
  with check (exists (select 1 from public.properties p where p.id = fractions.property_id));

-- creative_prompts
drop policy if exists "creative_prompts_all_policy" on public.creative_prompts;
drop policy if exists "creative_prompts_select_policy" on public.creative_prompts;
drop policy if exists "creative_prompts_tenant" on public.creative_prompts;
create policy "creative_prompts_tenant" on public.creative_prompts
  for all to authenticated
  using (
    (property_id is null and organization_id is null)
    or (property_id is not null
        and exists (select 1 from public.properties p where p.id = creative_prompts.property_id))
    or (organization_id is not null and organization_id = public.auth_org_id())
  )
  with check (
    (property_id is null and organization_id is null)
    or (property_id is not null
        and exists (select 1 from public.properties p where p.id = creative_prompts.property_id))
    or (organization_id is not null and organization_id = public.auth_org_id())
  );

-- distribution_batches: remove the misnamed permissive policy.
-- (tenant_isolation on user_id was already created by 20261111150100.)
drop policy if exists "organizations_all_policy" on public.distribution_batches;

commit;
