-- Business routines: the daily "CEO" loop.
--
-- Today a cron route decides what every business gets each day (an image, a video
-- every third day) in code. That is why changing the cadence needs a deploy, and why
-- the agent cannot adapt to a festival, an empty week or a listing going live.
--
-- A routine is DATA: a standing brief (intent), a cadence, a spend ceiling and an
-- approval policy. The materialiser turns a due routine into an ordinary harness run,
-- in that day's session, so everything the harness already does - leases, retries,
-- resume, checkpoint, dead-letter - applies unchanged.

create table if not exists public.business_routines (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  name              text not null,
  -- The standing brief. Written as an instruction to a chief of staff, not a config.
  intent            text not null,
  -- 'daily' | 'weekly' | 'monthly' | custom RRULE-ish text kept simple on purpose.
  cadence           text not null default 'daily',
  -- Local time the day starts, in the business's own timezone.
  run_at_hour       int  not null default 7,
  timezone          text not null default 'Asia/Kolkata',
  -- Hard ceiling for one day's run, in credits (1 credit = rupee of our cost x2).
  daily_credit_cap  numeric not null default 200,
  -- 'always' | 'auto_images' | 'never' - what needs the owner's tap before spending.
  approval_policy   text not null default 'always',
  -- Tool groups the run may use, chosen per intent to keep the prompt small.
  tool_groups       text[] not null default array['core','media']::text[],
  channels          text[] not null default array['whatsapp','email']::text[],
  enabled           boolean not null default true,
  version           int not null default 1,
  last_run_at       timestamptz,
  next_run_at       timestamptz default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists business_routines_due_idx
  on public.business_routines (next_run_at) where enabled;

create index if not exists business_routines_user_idx
  on public.business_routines (user_id, created_at desc);

-- One row per routine per period. The unique key is the exactly-once guarantee: a
-- re-run of the materialiser (cron overlap, retry, two workers) cannot double-spend.
create table if not exists public.routine_runs (
  id             uuid primary key default gen_random_uuid(),
  routine_id     uuid not null references public.business_routines(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  -- '2026-11-12' for daily, '2026-W46' for weekly.
  period_key     text not null,
  session_id     uuid,
  run_id         uuid,
  status         text not null default 'queued',
  plan           jsonb,
  digest         jsonb,
  credits_spent  numeric not null default 0,
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint routine_runs_period_unique unique (routine_id, period_key)
);

create index if not exists routine_runs_user_idx
  on public.routine_runs (user_id, created_at desc);

alter table public.business_routines enable row level security;
alter table public.routine_runs enable row level security;

drop policy if exists "owners manage their routines" on public.business_routines;
create policy "owners manage their routines"
  on public.business_routines for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "owners read their routine runs" on public.routine_runs;
create policy "owners read their routine runs"
  on public.routine_runs for select
  using (auth.uid() = user_id);

-- Keep updated_at honest without trusting the caller.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists business_routines_touch on public.business_routines;
create trigger business_routines_touch
  before update on public.business_routines
  for each row execute function public.touch_updated_at();

drop trigger if exists routine_runs_touch on public.routine_runs;
create trigger routine_runs_touch
  before update on public.routine_runs
  for each row execute function public.touch_updated_at();
