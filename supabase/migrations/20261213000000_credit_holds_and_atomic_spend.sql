-- ============================================================================
-- 20261213000000_credit_holds_and_atomic_spend.sql
--
-- Payment puts credits in the wallet. Work spends a RESERVED amount against a
-- SPECIFIC job. Until this migration the second half did not exist:
--
--   * utils/credits.ts did read-then-write (`hasEnoughCredits` then
--     `deductCredits`), which is check-then-act on a scalar. Two 60-credit
--     videos against a 100 balance both passed the check and both charged, so
--     the balance could go negative and the ledger disagreed with reality.
--   * There was no way to reserve money for a job that is about to run. An agent
--     composing three artefacts had no way to say "these 300 credits are mine
--     until this job finishes", so two concurrent runs raced each other.
--   * There was no way to release the unspent remainder of a half-finished job.
--     `voidSpend` voids one vendor record; it cannot give credits back.
--
-- This migration adds the three primitives that make the new model possible:
--
--   1. `credit_holds`  — a reservation against a named job. Availability is
--      `credits - sum(open holds)`. A hold does NOT move money; it only makes
--      the money unavailable to anyone else.
--   2. atomic spend/add — `update profiles set credits = credits - $1 where ...
--      and credits >= $1 returning credits`, in one statement, so the check and
--      the write cannot be interleaved. Returns NULL when the guard fails.
--   3. `grant_credits_once` — an idempotent credit grant keyed by an external
--      reference (a Razorpay payment id), so a retried client cannot be paid
--      twice. This is the idempotency the verify route never had.
--
-- Deliberate: NO volume caps here. Caps were removed in
-- 20261111230000_uncap_volume_use_approval.sql and must not come back.
-- A hold is a funding test for one job, not a ceiling on the business.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. A reference column on the ledger, so one external event can only ever be
--    applied once. Existing rows stay NULL and are unaffected by the index.
-- ----------------------------------------------------------------------------
alter table public.credit_transactions add column if not exists ref text;

comment on column public.credit_transactions.ref is
  'Idempotency key for the event that caused this row, e.g. razorpay:<payment_id>. Unique when present.';

create unique index if not exists credit_transactions_ref_uniq
  on public.credit_transactions (ref)
  where ref is not null;

-- ----------------------------------------------------------------------------
-- 1. Reservations
-- ----------------------------------------------------------------------------
create table if not exists public.credit_holds (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  job_id       text not null,
  amount       numeric not null check (amount >= 0),
  spent        numeric not null default 0 check (spent >= 0),
  state        text not null default 'open' check (state in ('open', 'settled', 'released')),
  reason       text,
  ref          text,
  expires_at   timestamptz,
  created_at   timestamptz not null default now(),
  settled_at   timestamptz
);

comment on table public.credit_holds is
  'Money reserved for a specific job. Available credits = profiles.credits - sum(open holds). A hold never moves money; charging does.';

-- One open hold per job: a retried job must attach to its existing reservation
-- instead of reserving a second time.
create unique index if not exists credit_holds_open_job_uniq
  on public.credit_holds (user_id, job_id)
  where state = 'open';

create index if not exists credit_holds_open_user_idx
  on public.credit_holds (user_id, state);

alter table public.credit_holds enable row level security;

-- Tenants may read their own holds (so the dashboard can explain "Rs 300 is
-- reserved for tonight's video"). Only the service role writes.
drop policy if exists credit_holds_select_own on public.credit_holds;
drop policy if exists "credit_holds_select_own" on public.credit_holds;
create policy "credit_holds_select_own" on public.credit_holds
  for select using (auth.uid() = user_id);

