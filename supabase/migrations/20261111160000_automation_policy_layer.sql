-- ============================================================================
-- 20261111160000_automation_policy_layer.sql
--
-- Backbone for the "marketing department" workflow.
--
-- Today every automation is opt-IN by accident: onboarding writes
-- properties.auto_generate = false, agent_policies is never provisioned, and
-- video enrollment has no working writer. Nothing runs for a new account.
--
-- This migration introduces a single source of truth for what a tenant wants:
--   public.tenant_automations  (master switch + one flag per feature)
-- and an atomic claim function so the calling cron can never double-dial.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Per-tenant automation policy. Defaults are ON: a new account gets the
--    full workflow unless they switch it off.
-- ---------------------------------------------------------------------------
create table if not exists public.tenant_automations (
  user_id                uuid primary key references public.profiles(id) on delete cascade,
  master_enabled         boolean not null default true,

  -- per-feature switches
  daily_creative         boolean not null default true,
  video_reel             boolean not null default true,
  weekly_whatsapp        boolean not null default true,
  ai_calling             boolean not null default true,
  website_autobuild      boolean not null default true,

  -- scheduling knobs
  timezone               text    not null default 'Asia/Kolkata',
  creative_hour_local    smallint not null default 9,    -- 0-23 local hour for the daily creative
  video_cadence_days     smallint not null default 3,    -- "30s video every Nth day"
  weekly_send_dow        smallint not null default 6,    -- 0=Sun .. 6=Sat (local)
  call_window_start      smallint not null default 9,    -- do-not-call outside 09:00..
  call_window_end        smallint not null default 19,   -- ..19:00 local

  -- calling cadence (see lib/automation/calling-cadence.ts)
  call_cadence           jsonb   not null default '[]'::jsonb,
  call_max_attempts      smallint not null default 18,
  call_tail_days         smallint not null default 30,   -- spacing once the cadence table is exhausted
  call_max_age_days      smallint not null default 365,  -- hard stop for very old leads

  -- safety
  bill_automation        boolean not null default true,  -- deduct credits for generated artefacts

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

alter table public.tenant_automations enable row level security;

drop policy if exists "tenant_automations_owner" on public.tenant_automations;
create policy "tenant_automations_owner" on public.tenant_automations
  for all to authenticated
  using (user_id = auth.uid() or public.is_same_tenant(user_id))
  with check (user_id = auth.uid() or public.is_same_tenant(user_id));

-- service_role needs full access for cron workers; RLS bypass covers it, but be explicit
grant select, insert, update on public.tenant_automations to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Backfill: every existing tenant gets a default-ON row, and agent_policies
--    finally gets populated (it had zero writer before this).
-- ---------------------------------------------------------------------------
insert into public.tenant_automations (user_id)
select p.id from public.profiles p
where p.role is distinct from 'super_admin'
on conflict (user_id) do nothing;

-- NOTE: agent_policies.user_id carries an FK to auth.users, and some profiles
-- rows are orphaned (id not present in auth.users). Join to auth.users so the
-- backfill cannot fail on those.
insert into public.agent_policies (user_id, is_enabled)
select p.id, true
from public.profiles p
join auth.users u on u.id = p.id
where p.role is distinct from 'super_admin'
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Safe JSON parsing.
--    leads.custom_fields is `text`, not jsonb, and may hold empty/malformed
--    values. Never let one bad row break the cron.
-- ---------------------------------------------------------------------------
create or replace function public.try_jsonb(t text)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if t is null or btrim(t) = '' then
    return null;
  end if;
  return t::jsonb;
exception when others then
  return null;
end $$;

revoke execute on function public.try_jsonb(text) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Atomic claim for the calling worker.
--    Two dialers (voice-caller */5 and reminders */10) previously raced and
--    could double-dial the same lead because the read-then-clear was not
--    atomic. This claims rows and stamps the lock.
-- ---------------------------------------------------------------------------
create or replace function public.claim_calls(p_ids uuid[])
returns table (id uuid, user_id uuid, phone text)
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.leads l
     set processing_lock_until = now() + interval '10 minutes'
   where l.id = any(p_ids)
     and (l.processing_lock_until is null or l.processing_lock_until < now())
  returning l.id, l.user_id, l.phone
$$;

revoke execute on function public.claim_calls(uuid[]) from anon;
grant execute on function public.claim_calls(uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Candidate read for the cadence engine (service_role only).
--    Returns fresh, unanswered, never-booked leads that are due for attention.
-- ---------------------------------------------------------------------------
create or replace function public.call_cadence_candidates(p_limit int default 500)
returns table (
  id uuid, user_id uuid, phone text, name text,
  created_at timestamptz, voice_call_retry_count int,
  voice_call_status text, pipeline_stage text,
  last_call_at timestamptz, scheduled_at timestamptz, custom_fields text
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    l.id, l.user_id, l.phone, l.name,
    l.created_at,
    coalesce(l.voice_call_retry_count, 0),
    l.voice_call_status,
    l.pipeline_stage,
    (select max(cl.started_at) from public.call_logs cl where cl.lead_id = l.id),
    l.voice_call_scheduled_at,
    l.custom_fields
  from public.leads l
  join public.tenant_automations ta on ta.user_id = l.user_id
  where ta.master_enabled
    and ta.ai_calling
    and coalesce(l.calling_enabled, true)
    and coalesce(l.pipeline_stage, 'New Lead') in ('New Lead', 'New')
    and l.booked_time is null
    and l.phone is not null and length(l.phone) >= 6
    and coalesce(l.voice_call_status, 'not_called') in ('not_called', 'scheduled_retry')
    and (l.processing_lock_until is null or l.processing_lock_until < now())
    and not coalesce((public.try_jsonb(l.custom_fields::text) ->> 'opt_out')::boolean, false)
    and (public.try_jsonb(l.custom_fields::text) ->> 'unsubscribed_at') is null
  order by l.voice_call_scheduled_at nulls first, l.created_at
  limit greatest(1, least(p_limit, 2000))
$$;

revoke execute on function public.call_cadence_candidates(int) from anon, authenticated;
grant execute on function public.call_cadence_candidates(int) to service_role;

commit;
