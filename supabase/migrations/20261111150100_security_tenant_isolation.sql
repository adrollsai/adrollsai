-- ============================================================================
-- 20261111150100_security_tenant_isolation.sql
--
-- Second half of the fix. The `USING (true)` policies also applied to every
-- authenticated user, so any logged-in account (94 profiles exist today, 53 of
-- them low-privilege `agent` accounts) could read every other tenant's leads,
-- properties, wallets, transactions and -- through `profiles` -- their WhatsApp
-- / Meta / ElevenLabs credentials.
--
-- Strategy:
--   * Where good tenant-scoped policies already existed (leads, properties,
--     assets, video_tasks, campaign_jobs, campaign_analyses,
--     qualification_forms), just DROP the permissive ones. The correct
--     policies created by 20260528064000 remain and take over.
--   * Where only a permissive policy existed, replace it with a uniform
--     `tenant_isolation` policy built on is_same_tenant().
--   * Where the table is service-role only, drop the policy and create none
--     (deny by default for anon/authenticated; service_role bypasses RLS).
--
-- Tenant resolution lives in SECURITY DEFINER helpers. This is essential:
-- writing the predicate inline (as 20260528064000 did) makes `profiles`
-- reference itself and Postgres aborts with
-- "infinite recursion detected in policy for relation profiles".
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Tenant-resolution helpers (SECURITY DEFINER => RLS bypassed => no recursion)
-- ---------------------------------------------------------------------------
create or replace function public.auth_parent_id()
returns uuid language sql stable security definer
set search_path = public, pg_temp
as $$ select parent_id from public.profiles where id = auth.uid() $$;

create or replace function public.auth_agency_id()
returns uuid language sql stable security definer
set search_path = public, pg_temp
as $$ select agency_id from public.profiles where id = auth.uid() $$;

create or replace function public.auth_org_id()
returns uuid language sql stable security definer
set search_path = public, pg_temp
as $$ select organization_id from public.profiles where id = auth.uid() $$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.role = 'super_admin' from public.profiles p where p.id = auth.uid()),
    false)
$$;

-- True when the caller may act on a row owned by `owner_id`.
-- Covers: self, my owner (parent_id), my agency, my staff/clients, same org,
-- and super_admin. Anonymous callers always get false.
create or replace function public.is_same_tenant(owner_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    owner_id is not null
    and auth.uid() is not null
    and (
      owner_id = auth.uid()
      or owner_id = (select p.parent_id from public.profiles p where p.id = auth.uid())
      or owner_id = (select p.agency_id from public.profiles p where p.id = auth.uid())
      or exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.role = 'super_admin')
      or exists (select 1 from public.profiles p
                  where p.id = owner_id
                    and (p.parent_id = auth.uid()
                      or p.agency_id = auth.uid()
                      or (p.organization_id is not null
                          and p.organization_id = (select q.organization_id
                                                     from public.profiles q
                                                    where q.id = auth.uid()))))
    ),
    false)
$$;

-- ---------------------------------------------------------------------------
-- 2. profiles -- was readable by every authenticated user, full row,
--    including whatsapp_access_token / facebook_token / elevenlabs_api_key.
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_select_policy" on public.profiles;
create policy "profiles_select_policy" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_same_tenant(id));

-- ---------------------------------------------------------------------------
-- 3. Tables that only ever had a permissive policy: replace with tenant policy.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'agent_ad_campaigns',
    'agent_events',
    'agent_pending_deliveries',
    'agent_policies',
    'automations',
    'campaigns',
    'customer_holdings',
    'distribution_batches',
    'distribution_items',
    'external_agents',
    'lead_history',
    'notifications',
    'organization_members',
    'push_subscriptions',
    'transactions',
    'wallet_transactions',
    'wallets',
    'whatsapp_broadcast_recipients',
    'whatsapp_broadcasts',
    'whatsapp_flows'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_all_policy', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_policy', t);
    execute format('drop policy if exists %I on public.%I',
                   'Service role access for ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'tenant_isolation', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using (public.is_same_tenant(user_id)) '
      'with check (public.is_same_tenant(user_id))',
      'tenant_isolation', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Tables whose own tenant policies already exist: drop only the permissive
--    ones and let the original (stricter) policies govern.
--    NOTE: leads.DELETE deliberately excluded agents; re-adding a blanket
--    policy here would silently widen it, so we add nothing.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'leads',
    'properties',
    'assets',
    'video_tasks',
    'campaign_jobs',
    'campaign_analyses',
    'qualification_forms'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_all_policy', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_policy', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Special cases
-- ---------------------------------------------------------------------------

-- organizations: no user_id column; scope by the caller's org.
drop policy if exists "organizations_all_policy" on public.organizations;
drop policy if exists "organizations_select_policy" on public.organizations;
create policy "organizations_tenant" on public.organizations
  for all to authenticated
  using (id = public.auth_org_id() or public.is_super_admin())
  with check (id = public.auth_org_id() or public.is_super_admin());

-- reference_creatives: shared catalogue rows have user_id IS NULL by design
-- (app/dashboard/reference-library reads `user_id IS NULL OR user_id = me`).
drop policy if exists "reference_creatives_select_policy" on public.reference_creatives;
drop policy if exists "reference_creatives_all_policy" on public.reference_creatives;
create policy "reference_creatives_read" on public.reference_creatives
  for select to authenticated
  using (user_id is null or public.is_same_tenant(user_id));
create policy "reference_creatives_write" on public.reference_creatives
  for all to authenticated
  using (public.is_same_tenant(user_id))
  with check (public.is_same_tenant(user_id));

-- posts: both a tenant policy (authenticated) and a published-only public read
-- (the anonymous catalogue page shows published posts).
drop policy if exists "posts_all_policy" on public.posts;
drop policy if exists "posts_select_policy" on public.posts;
create policy "posts_published_public" on public.posts
  for select using (status = 'published');
create policy "tenant_isolation" on public.posts
  for all to authenticated
  using (public.is_same_tenant(user_id))
  with check (public.is_same_tenant(user_id));

-- image_analysis_cache: intentionally shared as a cache, but drop the
-- PUBLIC-wide read and keep it to signed-in users only.
drop policy if exists "Allow all authenticated users to read image cache"
  on public.image_analysis_cache;
create policy "Allow all authenticated users to read image cache"
  on public.image_analysis_cache
  for select to authenticated using (true);

-- Service-role-only tables: remove the policy entirely.
drop policy if exists "master_creatives_all_policy" on public.master_creatives;
drop policy if exists "master_creatives_select_policy" on public.master_creatives;
drop policy if exists "Service role access for processed_webhook_messages"
  on public.processed_webhook_messages;

commit;
