-- ============================================================================
-- 20261111160100_automation_cadence_fixes.sql
--
-- Corrects the candidate query from 20261111160000.
--
-- Two defects found while testing against production:
--
-- 1. The status filter EXCLUDED leads in `no_answer` / `completed` / `failed`,
--    which are precisely the unanswered leads the cadence exists to chase.
--    The only status we must avoid is `calling` (a call in flight), or we
--    double-dial.
--
-- 2. Ordering by created_at globally meant one tenant's backlog consumed the
--    entire batch: 2,000 candidates came from just 2 of 14,006 eligible leads'
--    tenants. Ordering by a per-tenant row_number interleaves tenants fairly.
--
-- Also makes the "fresh" stage set configurable per tenant, so a business that
-- treats `Contacted` as still-chaseable can opt in without a code change.
-- ============================================================================

begin;

alter table public.tenant_automations
  add column if not exists call_fresh_stages text[]
  not null default array['New Lead', 'New'];

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
  with eligible as (
    select
      l.id, l.user_id, l.phone, l.name, l.created_at,
      coalesce(l.voice_call_retry_count, 0) as voice_call_retry_count,
      l.voice_call_status, l.pipeline_stage,
      (select max(cl.started_at) from public.call_logs cl where cl.lead_id = l.id) as last_call_at,
      l.voice_call_scheduled_at as scheduled_at,
      l.custom_fields,
      row_number() over (
        partition by l.user_id
        order by l.voice_call_scheduled_at nulls first, l.created_at
      ) as tenant_seq
    from public.leads l
    join public.tenant_automations ta on ta.user_id = l.user_id
    where ta.master_enabled
      and ta.ai_calling
      and coalesce(l.calling_enabled, true)
      and coalesce(l.pipeline_stage, 'New Lead') = any (ta.call_fresh_stages)
      and l.booked_time is null
      and l.phone is not null and length(l.phone) >= 6
      -- only skip a call that is literally in flight
      and coalesce(l.voice_call_status, 'not_called') <> 'calling'
      and coalesce(l.voice_call_retry_count, 0) < ta.call_max_attempts
      and l.created_at > now() - make_interval(days => ta.call_max_age_days)
      and (l.processing_lock_until is null or l.processing_lock_until < now())
      and not coalesce((public.try_jsonb(l.custom_fields::text) ->> 'opt_out')::boolean, false)
      and (public.try_jsonb(l.custom_fields::text) ->> 'unsubscribed_at') is null
  )
  select
    id, user_id, phone, name, created_at, voice_call_retry_count,
    voice_call_status, pipeline_stage, last_call_at, scheduled_at, custom_fields
  from eligible
  order by tenant_seq, created_at
  limit greatest(1, least(p_limit, 5000))
$$;

revoke execute on function public.call_cadence_candidates(int) from anon, authenticated;
grant execute on function public.call_cadence_candidates(int) to service_role;

commit;
