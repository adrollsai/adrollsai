-- P7 — the per-campaign lead journey (first reply, T+1h, T+1d).
--
-- One row per (lead, step). That unique key IS the idempotency guarantee: a
-- WhatsApp webhook that Meta retries ten times inserts once and therefore sends
-- once. `status` is the claim: pending -> sending is a compare-and-set, so two
-- crons (or two serverless instances) can never both send the same step.
--
-- The journey DEFINITION does not live here: it is data in the tenant's playbook
-- (`business_playbooks.cadence -> journey`), written through applyPlaybookPatch.
-- This table is only the schedule.

create table if not exists public.lead_journey_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  lead_id uuid not null references public.leads(id) on delete cascade,
  campaign_id uuid null,
  -- 'first_reply' | 'followup_1h' | 'followup_1d'
  step_id text not null,
  kind text not null check (kind in ('first_reply', 'followup')),
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'cancelled', 'blocked')),
  due_at timestamptz not null,
  body text not null,
  -- Approved Meta template used when the 24h service window is closed.
  template text null,
  intent text not null default '',
  attempts integer not null default 0,
  sent_at timestamptz null,
  cancelled_at timestamptz null,
  cancel_reason text null,
  -- A send that policy refused is kept with its reason. Never silently dropped.
  blocked_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_journey_steps_unique_step unique (lead_id, step_id)
);

-- The cron's only query: pending steps whose due_at has passed.
create index if not exists lead_journey_steps_due_idx
  on public.lead_journey_steps (status, due_at);

create index if not exists lead_journey_steps_lead_idx
  on public.lead_journey_steps (lead_id);

create index if not exists lead_journey_steps_user_idx
  on public.lead_journey_steps (user_id, status);

-- Service-role only: the cron and the webhook are the sole writers, and neither
-- reads through a user session.
alter table public.lead_journey_steps enable row level security;

comment on table public.lead_journey_steps is
  'P7 lead journey schedule. Unique (lead_id, step_id) makes a duplicated webhook delivery produce ONE send.';
