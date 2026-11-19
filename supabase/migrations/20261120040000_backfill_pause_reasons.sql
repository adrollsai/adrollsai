-- Give the campaigns that were paused before this existed a reason.
--
-- The new pre-flight reads history: if a campaign on this account was stopped by Meta, the next launch
-- will be refused the same way until the owner fixes it. That only works if the reason is recorded, and
-- the campaigns paused by the old worker had none — it wrote `status: 'paused'` and dropped the reason
-- into each failed row instead. The Blue Square Infra campaign is exactly that case, and the health
-- check reported "Ready" because of it.
--
-- Only campaigns that are actually PAUSED are stamped: a campaign that finished (even with some
-- failures) did deliver, and must not be labelled with a fatal reason.
update public.whatsapp_broadcasts b
set pause_reason = 'Meta refused the remaining sends: ' || t.reason
from (
  select
    broadcast_id,
    min(error_message) as reason
  from public.whatsapp_broadcast_recipients
  where status = 'failed'
    and (error_message ilike '%131042%' or error_code = '131042')
  group by broadcast_id
) t
where t.broadcast_id = b.id
  and b.pause_reason is null
  and b.status = 'paused';
