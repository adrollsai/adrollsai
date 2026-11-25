-- ============================================================================
-- 20261125120000_site_build_retry_and_force.sql
--
-- "Every tenant should have a site" was not true, and the queue was the reason.
--
-- 1. SKIPPED JOBS POISONED TENANTS FOREVER.
--    `enqueue_missing_sites` refused to enqueue a tenant that had any job with
--    status in ('pending','processing','completed'), and the worker wrote
--    `status='completed'` even when the build had been SKIPPED (`no_business_name`,
--    `profile_not_found`, `upsert_failed:…`). One early skip — typically because
--    the business name had not been filled in yet — meant that tenant was never
--    considered again. Nothing ever deletes `site_build_jobs` rows.
--
--    A skip is now `status='skipped'`, and only recent skips hold a tenant back:
--    a 12-hour cooldown keeps a genuinely unfixable row from churning every 15
--    minutes, while a tenant who fixes the underlying cause is picked up again on
--    its own, without an operator.
--
-- 2. A BROKEN PAGE WAS NEVER REPAIRED.
--    The gate was `not exists index`, so a row left behind by the old LLM path —
--    the self-refreshing "<meta http-equiv=refresh> Crafting Property Showcase"
--    placeholder — counted as "has a site" and was never re-examined. Tenants
--    whose only page is that placeholder are now treated as missing. The test is
--    deliberately narrow: it matches the two placeholder signatures only, so no
--    real page can ever be overwritten by it.
--
-- 3. AN OPERATOR COULD NOT TARGET A TENANT.
--    `?force=true` was accepted by the cron and never reached the enqueue, so it
--    was a no-op for the one case that mattered (an existing row or a completed
--    job). `p_user_id` + `p_force` make "build THIS tenant's site NOW" an actual
--    operation.
--
-- 4. The candidate set had no ORDER BY before its LIMIT, so which tenants were
--    considered at all was arbitrary. It is now oldest-account-first.
-- ============================================================================

begin;

-- A skip is a deferral, not a completion. Document the new status explicitly so
-- the intent survives the next reader.
comment on column public.site_build_jobs.status is
  'pending | processing | completed (built) | skipped (nothing to do — retried after a cooldown) | failed (attempts exhausted)';

-- The cooldown is data, not a magic number in SQL.
comment on column public.site_build_jobs.result is
  'Build outcome. For skipped jobs: {"skipped": "<reason>"}. Used by enqueue_missing_sites to apply the retry cooldown.';

create index if not exists site_build_jobs_user_created_idx
  on public.site_build_jobs (user_id, created_at desc);

create or replace function public.enqueue_missing_sites(
  p_limit   int  default 200,
  p_user_id uuid default null,
  p_force   boolean default false
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted int := 0;
begin
  with candidates as (
    select p.id
    from public.profiles p
    join public.tenant_automations ta on ta.user_id = p.id
    where ta.master_enabled
      and ta.website_autobuild
      and p.onboarding_completed
      and coalesce(btrim(p.business_name), '') <> ''
      -- Targeting: an operator naming one tenant must not be widened by the limit.
      and (p_user_id is null or p.id = p_user_id)
      -- Missing = no row, or a row that is still the generator's placeholder.
      -- The `force` path skips this test entirely (an explicit rebuild).
      and (
        p_force
        or not exists (
          select 1 from public.landing_pages lp
          where lp.user_id = p.id
            and lp.slug = 'index'
            and not (
              -- The self-refreshing spinner the old 60s-timeout generator left behind.
              coalesce(lp.html_content, '') like '%http-equiv="refresh"%'
              -- The empty template shell site-builder falls back to.
              or length(coalesce(lp.html_content, '')) < 400
            )
        )
      )
      and not exists (
        select 1 from public.site_build_jobs j
        where j.user_id = p.id
          and (
            j.status in ('pending', 'processing')
            -- A skip only defers: hold the tenant back for 12h, not forever.
            or (j.status = 'skipped' and j.updated_at > now() - interval '12 hours')
            -- A successful build is final — unless an operator forces a rebuild.
            or (j.status = 'completed' and not p_force)
          )
      )
    order by p.created_at nulls last, p.id
    limit greatest(1, least(p_limit, 2000))
  )
  insert into public.site_build_jobs (user_id, priority)
  select id, case when p_force then 0 else 100 end from candidates
  on conflict do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end $$;

revoke execute on function public.enqueue_missing_sites(int, uuid, boolean) from anon, authenticated;
grant execute on function public.enqueue_missing_sites(int, uuid, boolean) to service_role;

-- Keep existing callers working: the deployed cron calls rpc('enqueue_missing_sites', {p_limit}).
--
-- The 1-argument overload must be DROPPED, not replaced. `create or replace` refuses to
-- remove a parameter default (`42P13: cannot remove parameter defaults from existing
-- function`) because the old signature was `p_limit int default 200`, and leaving both
-- overloads in place makes a bare `{p_limit}` call ambiguous for PostgREST. The 3-argument
-- form above defaults `p_user_id` and `p_force`, so a one-argument call still resolves.
drop function if exists public.enqueue_missing_sites(int);

create or replace function public.enqueue_missing_sites(p_limit int)
returns int
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.enqueue_missing_sites(p_limit, null, false);
$$;

revoke execute on function public.enqueue_missing_sites(int) from anon, authenticated;
grant execute on function public.enqueue_missing_sites(int) to service_role;

commit;
