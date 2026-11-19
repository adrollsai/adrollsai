-- The broadcasts table has an audience column that was never created.
--
-- `app/api/whatsapp/broadcasts/route.ts` writes `recipient_csv_audience` when a campaign targets a
-- saved audience group, and `app/dashboard/flows/components/suite-analytics-view.tsx` reads it to
-- show which audience a campaign went to. The column has never existed in this database, so the
-- write silently fell back to an insert without it (the route carries a fallback for exactly that)
-- and the analytics table showed "All Leads" for every campaign ever sent — including one aimed at a
-- specific audience. Code and schema disagreed, and the schema was wrong: the product clearly means
-- to record this.
alter table public.whatsapp_broadcasts
  add column if not exists recipient_csv_audience text;

comment on column public.whatsapp_broadcasts.recipient_csv_audience is
  'Which saved audience group (or uploaded list) this campaign targeted, so the analytics table can say who it went to.';

-- The campaigns list and analytics both group by this.
create index if not exists whatsapp_broadcasts_audience_idx
  on public.whatsapp_broadcasts (user_id, recipient_csv_audience);
