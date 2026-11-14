-- ============================================================================
-- 20261214000000_crm_live_updates_and_lead_activity.sql
--
-- Two problems this fixes, both reported from real use:
--
-- 1. A NEW LEAD NEVER APPEARED WITHOUT A REFRESH.
--    app/dashboard/crm/page.tsx has subscribed to `postgres_changes` on `leads`
--    for a long time, but `leads` was never added to the `supabase_realtime`
--    publication — so the subscription could not fire. It was not a UI bug; no
--    event was ever sent. `notifications` had the same gap, so in-app alerts
--    only appeared on a page load.
--
-- 2. A REOPENED LEAD DID NOT COME BACK TO THE TOP.
--    The list is ordered by `created_at desc`, which is the moment the lead first
--    arrived. A lead that goes cold and is reopened months later is *new work
--    today* but sorts to the bottom, below everything created since. Ordering by
--    a `last_activity_at` stamp fixes that without destroying the real creation
--    date (which is used for reporting and for Meta attribution).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Make the live tables actually live.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'leads'
  ) then
    alter publication supabase_realtime add table public.leads;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- Realtime needs the full row to hand the client something renderable.
alter table public.leads replica identity full;
alter table public.notifications replica identity full;

-- ----------------------------------------------------------------------------
-- 2. Last activity, maintained by trigger so no writer has to remember.
-- ----------------------------------------------------------------------------
alter table public.leads
  add column if not exists last_activity_at timestamptz;

-- Existing rows keep their true age: a lead that has not moved since it arrived
-- is exactly as old as its created_at, and must not jump to the top on deploy.
update public.leads
   set last_activity_at = coalesce(created_at, now())
 where last_activity_at is null;

alter table public.leads
  alter column last_activity_at set default now();

create index if not exists leads_user_activity_idx
  on public.leads (user_id, last_activity_at desc);

comment on column public.leads.last_activity_at is
  'Bumped on every insert and update. The CRM list orders by this so a reopened or recently-touched lead surfaces at the top; created_at keeps the real arrival date for reporting.';

create or replace function public.touch_lead_activity()
returns trigger
language plpgsql
as $$
begin
  -- A writer that explicitly sets the stamp keeps its own value (bulk imports).
  if tg_op = 'UPDATE' and new.last_activity_at is distinct from old.last_activity_at then
    return new;
  end if;
  new.last_activity_at = now();
  return new;
end $$;

drop trigger if exists leads_touch_activity on public.leads;
create trigger leads_touch_activity
  before insert or update on public.leads
  for each row execute function public.touch_lead_activity();

commit;
