-- Usage events: one row per billable vendor call, wherever it came from.
--
-- Before this, usage only existed inside an agent turn: the chat route and the
-- durable runner opened a meter, and the turn's total was charged at the end.
-- Anything that called Gemini, Kie or E2B from a cron job, a webhook, a
-- dashboard route or a standalone script spent real money and left no trace at
-- all. This table is the trace.
--
-- Two columns carry the design:
--   settled_by = 'turn'  -> the agent turn's meter charged it (aggregated)
--   settled_by = 'route' -> charged directly here, outside any turn
--   priced = false       -> we know the call happened but have no rate for it,
--                           so it shows up as a countable gap instead of
--                           silently costing nothing.

create table if not exists public.usage_events (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  user_id     uuid references public.profiles(id) on delete set null,
  service     text not null,
  model       text,
  units       numeric,
  unit        text,
  cost_inr    numeric not null default 0,
  priced      boolean not null default true,
  settled_by  text not null default 'route',
  detail      text,
  meta        jsonb
);

create index if not exists usage_events_created_idx on public.usage_events (created_at desc);
create index if not exists usage_events_user_idx on public.usage_events (user_id, created_at desc);
create index if not exists usage_events_service_idx on public.usage_events (service, created_at desc);

alter table public.usage_events enable row level security;

-- Clients can audit their own spend; only the service role writes.
drop policy if exists "users read own usage" on public.usage_events;
create policy "users read own usage"
  on public.usage_events for select
  using (auth.uid() = user_id);

-- Convenience view: cost per service per day, including unpriced calls.
create or replace view public.usage_daily as
select
  date_trunc('day', created_at) as day,
  service,
  count(*)                                            as calls,
  sum(cost_inr)                                       as cost_inr,
  sum(case when priced then 0 else 1 end)             as unpriced_calls
from public.usage_events
group by 1, 2
order by 1 desc, 4 desc;
