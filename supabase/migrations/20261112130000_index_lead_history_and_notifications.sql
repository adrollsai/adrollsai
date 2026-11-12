-- ============================================================================
-- 20261112130000_index_lead_history_and_notifications.sql
--
-- Companion to 20261112120000_fix_leads_rls_performance.sql.
--
-- `lead_history` (117,200 rows) and `notifications` (67,022 rows) carried a
-- primary key and nothing else. Every application read of them was therefore a
-- full sequential scan, and since 20261111150100 every one of those rows also
-- evaluates a row-level tenant check. The analytics screen's lead_history count
-- measured 3.4 s against an 8 s statement_timeout - working, but one data
-- growth spurt away from the same 57014 timeout that broke the CRM.
--
--   lead_history(lead_id, created_at)   -> LeadHistoryModal, CRM lead detail
--   lead_history(user_id, created_at)   -> analytics call-tracking count
--   notifications(user_id, created_at)  -> notifications list
--   notifications(user_id) WHERE unread -> unread badge count
--
-- Indexes only; no policy or data change.
-- ============================================================================

create index if not exists idx_lead_history_lead_created_at
  on public.lead_history (lead_id, created_at desc);

create index if not exists idx_lead_history_user_created_at
  on public.lead_history (user_id, created_at desc);

create index if not exists idx_notifications_user_created_at
  on public.notifications (user_id, created_at desc);

create index if not exists idx_notifications_user_unread
  on public.notifications (user_id) where is_read = false;

analyze public.lead_history;
analyze public.notifications;
