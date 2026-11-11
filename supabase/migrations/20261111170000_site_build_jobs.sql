-- ============================================================================
-- 20261111170000_site_build_jobs.sql
--
-- Website generation must not depend on how long a single serverless
-- invocation is allowed to live. Work is therefore modelled as small, durable,
-- retryable jobs with a lease — the same claim pattern used for calling.
--
-- A job is a unit of work that finishes in well under a second (render HTML
-- from the template + upsert a row), so no invocation is ever "long". If the
-- platform kills the invocation mid-flight, the lease expires and the next tick
-- retries it. That is what makes this independent of Vercel's budget.
-- ============================================================================

begin;

create table if not exists public.site_build_jobs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  status        text not null default 'pending',   -- pending | processing | completed | failed
  attempts      int  not null default 0,
  max_attempts  int  not null default 5,
  priority      int  not null default 100,
  locked_until  timestamptz,
  last_error    text,
  result        jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists site_build_jobs_pick_idx
  on public.site_build_jobs (status, priority, created_at);

-- At most one open job per tenant.
create unique index if not exists site_build_jobs_one_open_per_tenant
  on public.site_build_jobs (user_id)
  where status in ('pending', 'processing');

alter table public.site_build_jobs enable row level security;

-- Dashboards may read their own job state; only the service role writes.
drop policy if exists "site_build_jobs_owner_read" on public.site_build_jobs;
create policy "site_build_jobs_owner_read" on public.site_build_jobs
  for select to authenticated
  using (user_id = auth.uid() or public.is_same_tenant(user_id));

grant select on public.site_build_jobs to authenticated;
grant all on public.site_build_jobs to service_role;

-- ---------------------------------------------------------------------------
-- Atomic claim: returns jobs and takes a 5-minute lease on them.
-- FOR UPDATE SKIP LOCKED means two concurrent ticks can never take one job.
-- ---------------------------------------------------------------------------
create or replace function public.claim_site_build_jobs(p_limit int default 5)
returns setof public.site_build_jobs
language sql
security definer
set search_path = public, pg_temp
as $$
  with picked as (
    select j.id
    from public.site_build_jobs j
    where j.status in ('pending', 'processing')
      and j.attempts < j.max_attempts
      and (j.locked_until is null or j.locked_until < now())
    order by j.priority, j.created_at
    limit greatest(1, least(p_limit, 25))
    for update skip locked
  )
  update public.site_build_jobs j
     set status = 'processing',
         attempts = j.attempts + 1,
         locked_until = now() + interval '5 minutes',
         updated_at = now()
    from picked
   where j.id = picked.id
  returning j.*;
$$;

revoke execute on function public.claim_site_build_jobs(int) from anon, authenticated;
grant execute on function public.claim_site_build_jobs(int) to service_role;

-- ---------------------------------------------------------------------------
-- Enqueue a build for every tenant that should have a site but has none.
-- Idempotent: the partial unique index prevents duplicate open jobs.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_missing_sites(p_limit int default 200)
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
      and not exists (
        select 1 from public.landing_pages lp
        where lp.user_id = p.id and lp.slug = 'index'
      )
      and not exists (
        select 1 from public.site_build_jobs j
        where j.user_id = p.id and j.status in ('pending','processing','completed')
      )
    limit greatest(1, least(p_limit, 2000))
  )
  insert into public.site_build_jobs (user_id)
  select id from candidates
  on conflict do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end $$;

revoke execute on function public.enqueue_missing_sites(int) from anon, authenticated;
grant execute on function public.enqueue_missing_sites(int) to service_role;

commit;
