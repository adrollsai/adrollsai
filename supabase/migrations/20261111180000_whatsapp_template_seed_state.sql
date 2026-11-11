-- ============================================================================
-- 20261111180000_whatsapp_template_seed_state.sql
--
-- Templates are only submitted to Meta when a tenant CONNECTS WhatsApp, so the
-- 59 tenants who connected before this change have none of the newer templates.
-- Without them, creative delivery and the weekly message cannot be delivered at
-- all (business-initiated messages must be templates).
--
-- This table makes the backfill idempotent and observable: it records when each
-- tenant's WABA was last seeded and the per-template result, so we can see which
-- templates Meta accepted and which were rejected/are pending.
-- ============================================================================

begin;

create table if not exists public.whatsapp_template_seed_state (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  waba_id    text,
  seeded_at  timestamptz not null default now(),
  results    jsonb,
  error      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_template_seed_state enable row level security;

drop policy if exists "template_seed_state_owner_read" on public.whatsapp_template_seed_state;
create policy "template_seed_state_owner_read" on public.whatsapp_template_seed_state
  for select to authenticated
  using (user_id = auth.uid() or public.is_same_tenant(user_id));

grant select on public.whatsapp_template_seed_state to authenticated;
grant all on public.whatsapp_template_seed_state to service_role;

commit;
