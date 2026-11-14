-- ============================================================================
-- 20261215000000_agent_runs.sql
--
-- The persistence the durable sandbox runner needs, and nothing else.
--
-- lib/agent/sandbox/runner.ts keeps the agent's plan OUTSIDE the sandbox: a step
-- list in code plus this row. That is the whole point of the design — on the
-- Hobby plan E2B kills a sandbox after 1 hour of CONTINUOUS runtime, so the row
-- is what lets a fresh sandbox resume "two of three steps done, 3 min of
-- continuous runtime burnt" instead of starting over (and re-billing) from zero.
--
-- WHY A TEXT PRIMARY KEY
-- The run id is minted by the caller (a route, a cron job, a human retry) BEFORE
-- the sandbox exists, because the same id has to key the credit hold
-- (credit_holds.job_id) and the ledger refs (credit_transactions.ref) too. A
-- uuid default would force us to create the row before we know the run, and the
-- resume path would then need a lookup table anyway.
--
-- WHAT `held` AND `charged` ARE
-- Not money. `held` is the reserve this runner took for the work it can still
-- perform, `charged` is the sum of the completed steps. They are a checkpoint so
-- a resumed run can compute the refund (held - charged) after a crash. The
-- authoritative numbers live in credit_holds / credit_transactions / profiles.
--
-- Additive only: this migration creates one table, one index and its policies.
-- It does not alter, rename or drop anything that already exists.
-- ============================================================================

create table if not exists public.agent_runs (
  run_id        text primary key,
  -- Who pays. Nullable because a run may be system-owned (a cron sweep with no
  -- tenant), and a run row must never be the reason a job cannot start.
  user_id       uuid references public.profiles(id) on delete cascade,
  sandbox_id    text,
  -- jsonb array of completed step names, in the order they finished.
  completed     jsonb not null default '[]'::jsonb
                check (jsonb_typeof(completed) = 'array'),
  -- Continuous runtime already burnt in the CURRENT sandbox window. Reset to 0
  -- every time the watchdog pauses and resumes, which is what keeps us under the
  -- platform's 1 hour continuous cap.
  continuous_ms bigint not null default 0 check (continuous_ms >= 0),
  held          numeric not null default 0 check (held >= 0),
  charged       numeric not null default 0 check (charged >= 0),
  -- 'running' while the runner owns the row; the caller records a terminal state.
  status        text check (status is null or status in ('running', 'paused', 'completed', 'failed', 'cancelled')),
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.agent_runs is
  'Checkpoint for the durable E2B sandbox pipeline (lib/agent/sandbox/runner.ts). Holds the plan, not the workspace.';
comment on column public.agent_runs.completed is
  'Step names already finished and charged. A step in here is never run or charged again.';
comment on column public.agent_runs.continuous_ms is
  'Continuous runtime burnt in the current sandbox window; reset when the watchdog pauses and resumes.';

-- The dashboard asks "what is this tenant's agent doing?" — one index for that.
create index if not exists agent_runs_user_updated_idx
  on public.agent_runs (user_id, updated_at desc);

-- Cleanup sweeps look for runs that stopped making progress.
create index if not exists agent_runs_status_updated_idx
  on public.agent_runs (status, updated_at)
  where status in ('running', 'paused');

-- ----------------------------------------------------------------------------
-- RLS: a tenant may read its own run; only the service role may write.
--
-- Writes are deliberately not policied. A run row is a billing checkpoint, so a
-- client that could write it could erase completed steps and cause a re-charge,
-- or fake progress to skip work it never paid for.
-- ----------------------------------------------------------------------------
alter table public.agent_runs enable row level security;

drop policy if exists agent_runs_select_own on public.agent_runs;
create policy agent_runs_select_own on public.agent_runs
  for select using (auth.uid() = user_id);

revoke all on public.agent_runs from anon, authenticated;
grant select on public.agent_runs to authenticated;
grant all on public.agent_runs to service_role;

-- ----------------------------------------------------------------------------
-- No new index for the credit side: the credits adapter looks a hold up by
-- (user_id, job_id, state = 'open'), which is exactly the partial unique index
-- credit_holds_open_job_uniq from 20261213000000_credit_holds_and_atomic_spend.sql.
-- The same migration's credit_transactions_ref_uniq is what makes a per-step
-- charge idempotent, so no schema change is needed there either.
-- ----------------------------------------------------------------------------
