-- Flow steps had no destination.
--
-- app/api/cron/flows inserted a row into agent_pending_deliveries for every due step, and
-- NOTHING ever read those rows: there was no approvals queue, no dispatcher, and the table did
-- not even have the columns the insert named (channel, to_phone, body, template_name, flow_id,
-- flow_step_index, trigger). So a flow that "queued" a message was writing a row that failed on
-- the missing columns — the scheduler reported execute_failed and no customer was ever reached.
--
-- This migration gives the queue its missing columns, a claim window, and the bookkeeping a
-- dispatcher needs to be honest about what actually went out. Then it makes a flow able to run
-- more than once per lead (run_key), because "inbound message" is an event you can generate more
-- than once and the old unique index made the second one a silent no-op for ever.

-- ── the delivery queue ────────────────────────────────────────────────────
alter table public.agent_pending_deliveries
  add column if not exists channel text,
  add column if not exists to_phone text,
  add column if not exists body text,
  add column if not exists template_name text,
  add column if not exists flow_id text,
  add column if not exists flow_step_index integer,
  add column if not exists trigger text,
  add column if not exists run_key text not null default 'once',
  add column if not exists error_message text,
  add column if not exists provider_message_id text,
  add column if not exists attempts integer not null default 0,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid,
  add column if not exists decided_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists claim_expires_at timestamptz;

-- Two statuses the dispatcher moves through that did not exist before: 'approved' (a human said
-- yes, nothing is sent yet) and 'sending' (claimed by one worker for a short window).
comment on column public.agent_pending_deliveries.status is
  'waiting_handshake | pending_approval | approved | rejected | sending | delivered | failed | blocked | expired';

-- The queue query: what is waiting for a human, oldest first.
create index if not exists agent_pending_deliveries_queue_idx
  on public.agent_pending_deliveries (status, created_at)
  where status in ('pending_approval', 'approved', 'sending');

create index if not exists agent_pending_deliveries_owner_idx
  on public.agent_pending_deliveries (user_id, status, created_at desc);

-- One row per flow step per run. Enqueuing the same step twice is a no-op rather than a second
-- message, which is the property that lets the cron be retried safely.
create unique index if not exists agent_pending_deliveries_flow_once_idx
  on public.agent_pending_deliveries (flow_id, lead_id, run_key, flow_step_index)
  where flow_id is not null;

-- ── runs, not "a flow may fire once per lead for ever" ────────────────────
alter table public.flow_schedules add column if not exists run_key text not null default 'once';
alter table public.flow_runs      add column if not exists run_key text not null default 'once';

drop index if exists public.flow_schedules_once_idx;
create unique index if not exists flow_schedules_run_once_idx
  on public.flow_schedules (flow_id, lead_id, run_key, step_index);

drop index if exists public.flow_runs_once_idx;
-- THE idempotency key, now scoped to a run: a retried tick cannot send the same step of the same
-- run twice, while a genuinely new inbound message can start a new run.
create unique index if not exists flow_runs_run_once_idx
  on public.flow_runs (flow_id, lead_id, run_key, step_index);

-- ── internal steps ────────────────────────────────────────────────────────
-- 'handoff' is a step that touches nothing outside the CRM (assign the lead, note it). It needs
-- no approval because it messages nobody and costs nothing, but it still has to be a legal kind
-- or the scheduler cannot record it.
alter table public.flow_schedules drop constraint if exists flow_schedules_kind_check;
alter table public.flow_schedules add constraint flow_schedules_kind_check
  check (kind in ('message', 'call', 'email', 'dm_reply', 'handoff'));

comment on column public.flow_schedules.run_key is
  'Which run of the flow this step belongs to. ''once'' for a flow that fires once per lead; the event id for an inbound trigger.';
