-- A campaign that stalls has to be able to say why.
--
-- On 19 Nov a Blue Square Infra broadcast created 16,317 recipients, sent 122, and then Meta refused
-- every remaining send with 131042 ("business eligibility payment issue"). The circuit breaker paused
-- the campaign — correctly — and then:
--   * 14,173 recipients sat at `pending` for ever, because nothing marked them unreachable;
--   * the reason lived only in each failed row's error text, so the campaign list could not say it;
--   * the UI showed "1000 recipients / few sent", because it counted a capped 1000-row page;
--   * there was no way to retry the failures, resume, or cancel from the product.
--
-- These columns give a campaign a truthful, cheap progress record and a place to keep the reason it
-- stopped. The recipient row gains the retry bookkeeping the worker needs to attempt a recoverable
-- failure again instead of calling it fatal.
alter table public.whatsapp_broadcasts
  add column if not exists pause_reason text,
  add column if not exists total_recipients integer,
  add column if not exists sent_count integer,
  add column if not exists failed_count integer,
  add column if not exists blocked_count integer,
  add column if not exists pending_count integer,
  add column if not exists last_progress_at timestamptz;

alter table public.whatsapp_broadcast_recipients
  add column if not exists attempts integer not null default 0,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists error_code text,
  add column if not exists updated_at timestamptz;

comment on column public.whatsapp_broadcasts.pause_reason is
  'Why the campaign stopped: Meta''s own words for a payment/eligibility/quality refusal, or a pause by the owner.';
comment on column public.whatsapp_broadcasts.blocked_count is
  'Recipients that were reached but could not be messaged, e.g. the account was paused mid-campaign.';
comment on column public.whatsapp_broadcast_recipients.attempts is
  'How many times the worker has tried this recipient — a recoverable failure is retried with backoff.';
comment on column public.whatsapp_broadcast_recipients.next_attempt_at is
  'When the worker may try again. Null means "as soon as possible".';

-- The worker's only hot query: the next slice of this campaign's pending rows.
create index if not exists whatsapp_broadcast_recipients_pending_idx
  on public.whatsapp_broadcast_recipients (broadcast_id, status, next_attempt_at)
  where status in ('pending', 'processing');

-- Counting one campaign's statuses is what the UI does on every poll.
create index if not exists whatsapp_broadcast_recipients_broadcast_status_idx
  on public.whatsapp_broadcast_recipients (broadcast_id, status);

-- Backfill the counters so existing campaigns stop showing nothing.
update public.whatsapp_broadcasts b
set
  total_recipients = coalesce(t.total, b.total_recipients),
  sent_count = coalesce(t.sent, b.sent_count),
  failed_count = coalesce(t.failed, b.failed_count),
  pending_count = coalesce(t.pending, b.pending_count),
  blocked_count = coalesce(t.blocked, b.blocked_count),
  last_progress_at = coalesce(t.last_update, b.last_progress_at)
from (
  select
    broadcast_id,
    count(*) as total,
    count(*) filter (where status = 'sent') as sent,
    count(*) filter (where status = 'failed') as failed,
    count(*) filter (where status = 'pending') as pending,
    count(*) filter (where status = 'blocked') as blocked,
    max(coalesce(sent_at, updated_at)) as last_update
  from public.whatsapp_broadcast_recipients
  group by broadcast_id
) t
where t.broadcast_id = b.id;
