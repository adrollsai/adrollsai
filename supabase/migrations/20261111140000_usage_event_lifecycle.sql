-- Two-phase spend: capture when a job is submitted, charge when it actually
-- produces something.
--
-- Metering at submission was wrong in the direction the user caught: a Kie task
-- that is created and then fails (their TTS job died with "generate task
-- timeout") would be billed for output that never existed. Metering only in the
-- tool was also wrong in the other direction — anything outside an agent turn
-- disappeared entirely.
--
-- So a row is now born 'pending' with cost 0, and becomes 'settled' only when the
-- result is in hand, or 'void' when the job fails. A row left 'pending' means we
-- never learned the outcome, which is itself worth seeing.

alter table public.usage_events
  add column if not exists state text not null default 'settled',
  add column if not exists settled_at timestamptz,
  add column if not exists ref text;

alter table public.usage_events
  drop constraint if exists usage_events_state_check;
alter table public.usage_events
  add constraint usage_events_state_check
  check (state in ('pending', 'settled', 'void'));

create index if not exists usage_events_state_idx
  on public.usage_events (state, created_at desc);

create index if not exists usage_events_ref_idx
  on public.usage_events (ref) where ref is not null;

-- Pending rows must not count towards spend, and unpriced settled rows must stay
-- countable, so the rollup is explicit about both.
-- column set changes, so replace is not enough
drop view if exists public.usage_daily;
create view public.usage_daily as
select
  date_trunc('day', created_at)                                as day,
  service,
  count(*) filter (where state = 'settled')                    as settled_calls,
  count(*) filter (where state = 'void')                       as failed_calls,
  count(*) filter (where state = 'pending')                    as unconfirmed_calls,
  sum(cost_inr) filter (where state = 'settled')               as cost_inr,
  count(*) filter (where state = 'settled' and not priced)     as unpriced_calls
from public.usage_events
group by 1, 2
order by 1 desc, 6 desc;
