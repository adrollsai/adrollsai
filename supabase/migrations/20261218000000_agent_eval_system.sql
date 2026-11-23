-- ============================================================================
-- 20261218000000_agent_eval_system.sql
--
-- THE MEMORY AN EVAL SUITE NEEDS.
--
-- The repo already had 27 `verify:*` gates, and `scripts/verify-scenarios.ts`
-- already asserted which tools and guardrails reach the model. What none of them
-- could answer is the question the business actually asks:
--
--     "Is the agent better or worse than it was last week?"
--
-- A gate is a boolean printed to a console. `.dsh-gates.ps1` even deletes its own
-- log every run (`Remove-Item $Log -Force`), so every run started from zero
-- memory: no pass RATE, no trend, no way to notice that a prompt change fixed two
-- scenarios while quietly breaking five. A boolean cannot be trended.
--
-- These two tables are that memory. `agent_eval_runs` is one row per suite
-- execution (the scorecard); `agent_eval_results` is one row per case per run
-- (the detail behind the scorecard). Together they turn "it passed" into
-- "92.9% of 47 cases, 0 guardrail breaches, ₹12.40 per full suite, and case
-- `safety/bulk-whatsapp-without-approval` has been PASS for 31 consecutive runs".
--
-- WHY A SEPARATE TABLE FROM agent_runs
-- `agent_runs` (20261215000000_agent_runs.sql) is a BILLING/durability
-- checkpoint for one user's task and is scoped to that user. An eval run belongs
-- to nobody: it is engineering telemetry measured against a throwaway profile.
-- Mixing them would pollute tenant queries and put eval rows behind a tenant RLS
-- policy that has no honest answer for "whose row is this?".
--
-- WHY suite_hash AND git_sha
-- A score is meaningless without the thing it scored. Two runs are only
-- comparable when the cases, the prompts and the code are the same; the hash and
-- the sha are what let the trend query refuse to compare a 40-case suite to a
-- 47-case one, and let a regression be pinned to a commit rather than to a day.
--
-- Additive only: two new tables, their indexes and their policies. No existing
-- table, column or policy is altered, renamed or dropped.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The scorecard: one row per suite execution.
-- ----------------------------------------------------------------------------
create table if not exists public.agent_eval_runs (
  run_id             uuid primary key default gen_random_uuid(),
  -- Which tiers actually ran. 'all' means context THEN behaviour in one run.
  tier               text not null check (tier in ('context', 'behaviour', 'all')),
  -- 'running' is written when the run starts, so a crashed suite leaves evidence
  -- instead of vanishing. Only 'completed' rows are eligible as a baseline.
  status             text not null default 'running'
                     check (status in ('running', 'completed', 'aborted', 'failed')),

  -- Reproducibility: what was evaluated, and what evaluated it.
  suite_version      text not null,
  suite_hash         text not null,
  git_sha            text,
  -- The model the agent actually served on. Recorded per run AND per result
  -- because `getAgentModel()` silently falls back to Gemini when the DeepSeek key
  -- is rejected (lib/agent/deepseek.ts). A score that drops because the provider
  -- changed under us must be visible as a column, not discovered by accident.
  model_primary      text,
  judge_model        text,
  -- The throwaway account the suite ran against. Null means no model turns were
  -- made (context tier only), which needs no account at all.
  profile_id         uuid references public.profiles(id) on delete set null,
  -- How many times each case was repeated. >1 is how flakiness is measured: a
  -- case that passes 1 of 3 repeats is not a pass and must not read as one.
  repeat             integer not null default 1 check (repeat >= 1),

  -- The scorecard itself.
  total_cases        integer not null default 0 check (total_cases >= 0),
  passed_cases       integer not null default 0 check (passed_cases >= 0),
  failed_cases       integer not null default 0 check (failed_cases >= 0),
  -- Fraction of CASES that passed. Deliberately not weighted.
  pass_rate          numeric(6, 4) check (pass_rate is null or (pass_rate >= 0 and pass_rate <= 1)),
  -- Mean per-case score (0..1). Unlike pass_rate this gives partial credit, so a
  -- small quality slide shows up before a case fully flips to failing.
  weighted_score     numeric(6, 4)
                     check (weighted_score is null or (weighted_score >= 0 and weighted_score <= 1)),
  -- A case where a forbidden tool was called, or a dangerous tool was exposed.
  -- Non-zero here fails the run no matter how good the average looks: an agent
  -- that is 97% helpful and 3% unapproved-spending is not a 97% agent.
  guardrail_breaches integer not null default 0 check (guardrail_breaches >= 0),
  flaky_cases        integer not null default 0 check (flaky_cases >= 0),

  -- Unit economics. cost_inr is OUR vendor cost, priced through
  -- lib/agent/pricing.ts, so a suite that got 40% more expensive is visible.
  total_cost_inr     numeric(14, 6) not null default 0 check (total_cost_inr >= 0),
  total_tokens_in    bigint not null default 0 check (total_tokens_in >= 0),
  total_tokens_out   bigint not null default 0 check (total_tokens_out >= 0),
  p50_latency_ms     integer,
  p95_latency_ms     integer,

  -- Regression tracking. The baseline is the previous COMPLETED run of the same
  -- tier with the same suite_hash, unless the caller pinned one explicitly.
  baseline_run_id    uuid references public.agent_eval_runs(run_id) on delete set null,
  regressions        integer not null default 0 check (regressions >= 0),
  improvements       integer not null default 0 check (improvements >= 0),

  -- 'fail'       something actually failed (critical case or guardrail breach)
  -- 'regressed'  nothing failed, but something passed before and does not now
  -- 'pass'       clean, and nothing slipped
  verdict            text check (verdict is null or verdict in ('pass', 'regressed', 'fail')),
  -- Per-series rollup: { "safety": { passed, total, score }, ... }. Denormalised
  -- because the per-category read is the one a human actually looks at, and a
  -- single number hides exactly the regression that matters.
  by_series          jsonb not null default '{}'::jsonb,
  notes              text,

  started_at         timestamptz not null default now(),
  finished_at        timestamptz
);

comment on table public.agent_eval_runs is
  'One row per agent eval suite execution (the scorecard). Written by lib/evals/store.ts via scripts/run-evals.ts.';
comment on column public.agent_eval_runs.suite_hash is
  'SHA-256 of the canonical case set. Trend queries must only compare runs with an equal hash.';
comment on column public.agent_eval_runs.model_primary is
  'The model actually served during the run — makes a silent Gemini fallback visible as data rather than as a mystery score drop.';
comment on column public.agent_eval_runs.verdict is
  'fail = something failed or a guardrail was breached; regressed = clean but previously-passing cases now fail; pass = clean.';
comment on column public.agent_eval_runs.guardrail_breaches is
  'Cases where a forbidden tool was called or a dangerous tool was exposed. Non-zero fails the run regardless of pass_rate.';

-- The trend query: "the last N completed runs of this tier".
create index if not exists agent_eval_runs_tier_started_idx
  on public.agent_eval_runs (tier, started_at desc);

-- Baseline lookup: newest completed run for a (tier, suite_hash) pair.
create index if not exists agent_eval_runs_baseline_idx
  on public.agent_eval_runs (tier, suite_hash, started_at desc)
  where status = 'completed';

-- "Find the run that regressed after this commit."
create index if not exists agent_eval_runs_git_sha_idx
  on public.agent_eval_runs (git_sha)
  where git_sha is not null;

-- A crashed suite must be findable so it does not silently masquerade as "no
-- change since yesterday".
create index if not exists agent_eval_runs_running_idx
  on public.agent_eval_runs (started_at)
  where status = 'running';

-- ----------------------------------------------------------------------------
-- The detail: one row per case per run.
-- ----------------------------------------------------------------------------
create table if not exists public.agent_eval_results (
  id                 bigserial primary key,
  run_id             uuid not null references public.agent_eval_runs(run_id) on delete cascade,

  -- case_id is the stable kebab id from evals/cases/*.json, NOT a row id: it is
  -- the key the trend is built on, so renaming a case is a deliberate migration
  -- rather than an accident that resets its history.
  case_id            text not null,
  case_title         text not null,
  tier               text not null check (tier in ('context', 'behaviour')),
  series             text not null,
  -- 'critical' cases are the ones that cost money, reach a customer or destroy
  -- data. A critical failure fails the whole run.
  severity           text not null check (severity in ('critical', 'high', 'normal')),

  passed             boolean not null,
  -- 0..1, weighted by severity. Gives partial credit within a case.
  score              numeric(6, 4) not null default 0
                     check (score >= 0 and score <= 1),
  guardrail_breach   boolean not null default false,

  -- Behaviour-tier measurements. Null on the context tier, which makes no model
  -- call at all.
  tool_accuracy      numeric(6, 4)
                     check (tool_accuracy is null or (tool_accuracy >= 0 and tool_accuracy <= 1)),
  steps              integer,
  tokens_in          bigint,
  tokens_out         bigint,
  cost_inr           numeric(14, 6),
  latency_ms         integer,
  served_model       text,
  -- Did the review gate actually intercept a spend/send attempt? (lib/agent/review-gate.ts)
  -- Recorded separately because "asked for approval" and "was blocked and asked"
  -- are different behaviours and both are good news.
  approval_gate_hit  boolean not null default false,

  -- Evidence, so a failure can be diagnosed without re-running a paid suite.
  assertions         jsonb not null default '[]'::jsonb,
  failure_reasons    jsonb not null default '[]'::jsonb,
  tools_called       jsonb not null default '[]'::jsonb,
  -- Trimmed deliberately: a full transcript can hold customer data and would make
  -- this table the biggest one in the database. The full reply stays in the
  -- on-disk JSON artefact under evals/reports/.
  reply_excerpt      text,
  -- LLM-judge output: { criteria: {...}, overall, verdict, reasoning, model }.
  -- Null when judging was off or the judge itself failed.
  judge              jsonb,

  -- Flakiness: repeat_passed of repeat_total. `flaky` is 0 < passed < total.
  flaky              boolean not null default false,
  repeat_passed      integer not null default 1 check (repeat_passed >= 0),
  repeat_total       integer not null default 1 check (repeat_total >= 0),

  -- Did this case pass in the baseline run? Null = no baseline, or a new case.
  baseline_passed    boolean,
  -- 'regression' = passed before, fails now. 'improvement' = the reverse.
  -- 'new' = no baseline row for this case. 'same' = unchanged.
  transition         text check (transition is null
                     or transition in ('same', 'regression', 'improvement', 'new')),

  created_at         timestamptz not null default now(),

  -- One result per case per run. Enforced, not assumed: a retried insert must not
  -- double-count a case and inflate pass_rate.
  unique (run_id, case_id)
);

comment on table public.agent_eval_results is
  'Per-case detail for one agent eval run. One row per (run_id, case_id); written by lib/evals/store.ts.';
comment on column public.agent_eval_results.transition is
  'regression = passed in the baseline run and fails now; improvement = the reverse; new = no baseline row.';
comment on column public.agent_eval_results.reply_excerpt is
  'Trimmed reply for diagnosis. Full transcripts live in the evals/reports/*.json artefact, not here.';
comment on column public.agent_eval_results.approval_gate_hit is
  'True when the review gate returned needs_review for a tool the case provoked — the gate biting, which is the intended behaviour.';

-- The run's own detail view.
create index if not exists agent_eval_results_run_idx
  on public.agent_eval_results (run_id, case_id);

-- The per-case trend: "show me every result for this case, newest first".
create index if not exists agent_eval_results_case_idx
  on public.agent_eval_results (case_id, created_at desc);

-- "Which cases regressed in the last 30 days?"
create index if not exists agent_eval_results_transition_idx
  on public.agent_eval_results (transition, created_at desc)
  where transition in ('regression', 'improvement');

-- "Show me every guardrail breach we have ever had" — the one query that must
-- never be slow, because it is the one that gets shown to a customer.
create index if not exists agent_eval_results_breach_idx
  on public.agent_eval_results (created_at desc)
  where guardrail_breach = true;

-- ----------------------------------------------------------------------------
-- RLS: engineering telemetry, service role only.
--
-- Deliberately NO policy for anon/authenticated and no grant either. These rows
-- describe how the product can FAIL — every known weak spot, which prompt breaks
-- under which request, and which guardrail was ever bypassed. That is an internal
-- engineering artefact and it is not a tenant's business.
--
-- If a customer-facing "reliability / trust panel" is ever shipped, do NOT open
-- these tables to authenticated. Add a small curated table (or a SECURITY DEFINER
-- function) that exposes only the published headline numbers for one tenant, so a
-- permissive policy here can never leak the failure corpus.
-- ----------------------------------------------------------------------------
alter table public.agent_eval_runs    enable row level security;
alter table public.agent_eval_results enable row level security;

revoke all on public.agent_eval_runs    from anon, authenticated;
revoke all on public.agent_eval_results from anon, authenticated;

grant all on public.agent_eval_runs    to service_role;
grant all on public.agent_eval_results to service_role;

-- bigserial carries its own sequence; an explicit grant keeps inserts working
-- under the service role without needing ownership.
grant usage, select on sequence public.agent_eval_results_id_seq to service_role;

-- ----------------------------------------------------------------------------
-- One convenience view for the question a human asks most: "how are we trending?"
--
-- Completed runs only, newest first, with the numbers already shaped for reading.
-- Created here rather than in TypeScript so a dashboard can query it directly.
-- ----------------------------------------------------------------------------
create or replace view public.agent_eval_trend as
select
  run_id,
  tier,
  started_at,
  git_sha,
  model_primary,
  suite_version,
  total_cases,
  passed_cases,
  pass_rate,
  weighted_score,
  guardrail_breaches,
  flaky_cases,
  regressions,
  improvements,
  total_cost_inr,
  p50_latency_ms,
  p95_latency_ms,
  verdict
from public.agent_eval_runs
where status = 'completed'
order by started_at desc;

comment on view public.agent_eval_trend is
  'Completed eval runs, newest first. The read path for a reliability dashboard; excludes crashed (running/aborted) runs.';

revoke all on public.agent_eval_trend from anon, authenticated;
grant select on public.agent_eval_trend to service_role;
