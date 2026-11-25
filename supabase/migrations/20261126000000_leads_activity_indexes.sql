-- Keep the CRM's lead list fast on a large book.
--
-- The CRM orders leads by `last_activity_at` (newest activity first) and filters to one workspace with
-- `user_id = X OR assigned_to = X`. Measured on the 16,415-lead workspace, each 1,000-row page took
-- ~600 ms and a full load was 17 pages / ~32 MB. The bytes are the page's own problem (bounded now);
-- this is about the server side: without an index matching the workspace filter AND the sort, every
-- page is a full scan plus a sort of the whole table, and OFFSET makes the later pages pay for the
-- earlier ones again.
--
-- Two indexes, one per side of that OR, both carrying the sort column so the planner can walk them in
-- order instead of sorting afterwards.

create index if not exists leads_user_activity_idx
  on public.leads (user_id, last_activity_at desc);

create index if not exists leads_assigned_activity_idx
  on public.leads (assigned_to, last_activity_at desc);

-- The bookkeeping columns the list reads are small, but the two that dominate the payload are not:
-- `custom_fields` (48% of the bytes) and `notes` (25%). Nothing here changes what is stored — this
-- comment exists so the next person measuring the load knows where the weight is.

analyze public.leads;
