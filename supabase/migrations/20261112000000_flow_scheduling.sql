-- Durable waiting for flows.
--
-- A flow cannot sleep. Every wait becomes a row here with an absolute time, and a clock tick
-- (app/api/cron/flows) picks up whatever is due. That is what makes "follow up tomorrow" possible
-- instead of a 10-second cap that silently fires everything at once.
--
-- Two tables, two different jobs:
--   flow_schedules â€” what is owed and when. One row per action per lead.
--   flow_runs      â€” what already happened. The unique key here is the idempotency guarantee: a
--                    retried tick, a redeployed worker or a double-fired webhook cannot send the
--                    same step to the same person twice.

create table if not exists public.flow_schedules (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  flow_id      text not null,
  lead_id      text not null,
  step_index   integer not null,
  kind         text not null check (kind in ('message', 'call', 'email', 'dm_reply')),
  payload      jsonb not null default '{}'::jsonb,
  run_at       timestamptz not null,
  status       text not null default 'pending' check (status in ('pending', 'claimed', 'done', 'skipped')),
  attempts     integer not null default 0,
  claimed_at   timestamptz,
  skip_reason  text,
  created_at   timestamptz not null default now()
);

-- The worker's only hot query: pending rows whose time has come.
create index if not exists flow_schedules_due_idx
  on public.flow_schedules (run_at)
  where status = 'pending';

-- One queued row per action per lead, so enqueuing twice cannot double the work.
create unique index if not exists flow_schedules_once_idx
  on public.flow_schedules (flow_id, lead_id, step_index);

create index if not exists flow_schedules_lead_idx
  on public.flow_schedules (lead_id, created_at desc);

create table if not exists public.flow_runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  flow_id     text not null,
  lead_id     text not null,
  step_index  integer not null,
  kind        text not null,
  ran_at      timestamptz not null default now()
);

-- THE idempotency key. A step runs once per lead, for ever.
create unique index if not exists flow_runs_once_idx
  on public.flow_runs (flow_id, lead_id, step_index);

-- Cross-flow freshness: "has this person been messaged recently, by anybody?"
create index if not exists flow_runs_lead_recent_idx
  on public.flow_runs (lead_id, ran_at desc);

-- Session kill switch and per-flow pause live on automations (is_active) plus this flag, so the
-- owner can stop the entire scheduler without touching any individual flow.
create table if not exists public.flow_settings (
  user_id     uuid primary key,
  all_paused  boolean not null default false,
  quiet_start integer not null default 21 check (quiet_start between 0 and 23),
  quiet_end   integer not null default 9  check (quiet_end between 0 and 23),
  updated_at  timestamptz not null default now()
);

alter table public.flow_schedules enable row level security;
alter table public.flow_runs      enable row level security;
alter table public.flow_settings  enable row level security;

-- The service role writes these; owners read their own.
drop policy if exists flow_schedules_owner_read on public.flow_schedules;
create policy flow_schedules_owner_read on public.flow_schedules for select using (auth.uid() = user_id);
drop policy if exists flow_runs_owner_read on public.flow_runs;
create policy flow_runs_owner_read on public.flow_runs for select using (auth.uid() = user_id);
drop policy if exists flow_settings_owner_all on public.flow_settings;
create policy flow_settings_owner_all on public.flow_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.flow_schedules is
  'Durable waits. A flow never sleeps; it writes a row here and a clock tick executes it.';
comment on table public.flow_runs is
  'Completed steps. The unique (flow_id, lead_id, step_index) index is the no-double-send guarantee.';
