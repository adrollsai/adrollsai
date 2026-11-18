-- The opt-out flag the flow gates read did not exist.
--
-- lib/flows/store.ts asked every lead "is this person opted out?" by selecting `opted_out`. The
-- column was never created, so the query errored, and the store correctly refused to message a lead
-- it could not read — which meant EVERY flow step on every account was skipped as "opted_out" and
-- no flow could ever reach anybody. A gate that fails closed is right; a gate that fails closed
-- because its column is missing is a product that silently does nothing.
--
-- The flag belongs on the lead: opt-out is a property of the person, not of a flow, and every
-- channel (WhatsApp, call, email) has to honour the same answer.
alter table public.leads
  add column if not exists opted_out boolean not null default false;

comment on column public.leads.opted_out is
  'The person asked not to be contacted. Every flow gate, drip and send path must honour it.';

-- The scheduler asks this per due step, so it needs to be cheap.
create index if not exists leads_opted_out_idx
  on public.leads (user_id)
  where opted_out = true;
