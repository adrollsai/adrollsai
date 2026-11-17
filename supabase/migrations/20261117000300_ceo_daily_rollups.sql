-- CEO daily rollups: one bounded row per tenant per day, so the CEO tab never grows without limit.
--
-- THE PROBLEM THIS SOLVES
-- The CEO tab reads routine_runs and agent_events, which grow forever. Rendering "what happened" by
-- scanning raw history gets slower every week, and — worse — anything that later feeds history into an
-- agent prompt would grow the context until it degraded. A summary row per day is bounded by
-- construction: 365 rows a year per tenant, whatever the activity level.
--
-- The shape is deliberately dumb JSONB. The report shape already exists in lib/automation/eod-report.ts
-- (built by buildEodReport, which is pure and gated by verify:ceo-guide), so the rollup stores exactly
-- what that produced rather than a second schema that can drift from it.

create table if not exists public.ceo_daily_rollups (
  user_id     uuid        not null references public.profiles(id) on delete cascade,
  day         date        not null,
  -- The EodReport fields worth keeping forever: headline, sentiment, metrics, section lines, facts.
  payload     jsonb       not null default '{}'::jsonb,
  -- How many raw events this row summarises, so the tab can say "and 47 more" without a count query.
  event_count integer     not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, day)
);

-- The tab's only read pattern: newest days for one tenant, bounded by a limit.
create index if not exists ceo_daily_rollups_user_day_idx
  on public.ceo_daily_rollups (user_id, day desc);

alter table public.ceo_daily_rollups enable row level security;

-- A tenant may read its own rollups. Writes go through the service role (the nightly job), so no
-- insert/update policy is granted to authenticated users on purpose: this table is a record, not a
-- user-editable surface.
drop policy if exists ceo_daily_rollups_select_own on public.ceo_daily_rollups;
drop policy if exists "ceo_daily_rollups_select_own" on public.ceo_daily_rollups;
create policy "ceo_daily_rollups_select_own" on public.ceo_daily_rollups
  for select
  to authenticated
  using (auth.uid() = user_id);

comment on table public.ceo_daily_rollups is
  'One bounded summary row per tenant per day for the CEO tab. Keeps history reads constant-time and keeps agent context from growing with history.';
