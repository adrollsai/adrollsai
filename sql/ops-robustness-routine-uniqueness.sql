-- Two constraints that make the duplicate-routine-run bug impossible rather than unlikely.
--
-- WHAT WENT WRONG
-- Nothing stopped a business from holding several `business_routines` rows, and the
-- idempotency key that guards routine runs is `(routine_id, period_key)` — per routine, not per
-- business. So N routine rows meant N runs for the same day, each with its own key and therefore
-- no dedupe. Measured on production before this migration: six runs for one tenant on
-- 2026-11-12, three on 2026-11-23, two on two other days. Each of them died silently to the
-- unrelated "no user message" bug, which is the only reason it cost nothing.
--
-- (Those runs also explain why `routine_runs` was empty: its FK to `business_routines` cascades
-- on delete, so removing the stray routine rows took their claims with them.)
--
-- Both statements are idempotent: this file can be re-run safely.

-- ── 1. A business has at most one ENABLED routine ────────────────────────────────
-- Partial on `enabled` so disabled leftovers are allowed: they do nothing, and deleting a
-- customer's configuration to satisfy a constraint is not a migration's job. This is what the
-- code already assumes — `loadRoutine()` in lib/agent/tools/routine.ts picks the oldest row and
-- the CEO tab treats the routine as singular — so the schema is being brought in line with the
-- product, not the other way round.
create unique index if not exists business_routines_one_enabled_per_user
  on public.business_routines (user_id)
  where enabled;

-- ── 2. One claim per business per period, not per routine row ────────────────────
-- The original `(routine_id, period_key)` key cannot see a duplicate routine row, so it could
-- not prevent the second run. This one can.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.routine_runs'::regclass
      and conname = 'routine_runs_tenant_period_unique'
  ) then
    alter table public.routine_runs
      add constraint routine_runs_tenant_period_unique unique (user_id, period_key);
  end if;
end $$;

comment on index public.business_routines_one_enabled_per_user is
  'A business has one standing routine. Duplicate enabled rows made the cron queue one run per row per period.';
