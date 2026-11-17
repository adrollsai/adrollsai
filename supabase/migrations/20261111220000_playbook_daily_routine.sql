-- ============================================================================
-- 20261111220000_playbook_daily_routine.sql
--
-- The daily routine is now owned by the agent: what runs each day, in what
-- order, at what local time, and with which channels. Storing it inside the
-- playbook (rather than scattered cron constants) means the user can change it
-- in plain language and the change is versioned like everything else.
-- ============================================================================

begin;

alter table public.business_playbooks add column if not exists daily_routine jsonb not null default '{}'::jsonb;

comment on column public.business_playbooks.daily_routine is
  'Agent-authored daily schedule, e.g. {"jobs":[{"kind":"creative","at":"09:00"},{"kind":"video","every_days":3}]}';

commit;
