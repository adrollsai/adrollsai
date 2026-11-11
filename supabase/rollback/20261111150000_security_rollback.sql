-- ============================================================================
-- ROLLBACK for the 2026-11-11 security migrations.
--
-- NOT a migration. Lives outside supabase/migrations/ on purpose so that
-- `supabase db push` never applies it. Run it manually only if a production
-- regression is traced to the lockdown.
--
-- WARNING: applying this file re-opens a public data breach — 39,112 leads and
-- every tenant's WhatsApp/Meta/ElevenLabs tokens become world-readable again.
-- Prefer fixing forward.
--
-- Applied migrations this reverts:
--   20261111150000_security_lockdown_anon.sql
--   20261111150100_security_tenant_isolation.sql
--   20261111150200_security_tenant_isolation_followup.sql
-- ============================================================================

begin;

-- ---- 1. restore anon grants ------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('grant all on table public.%I to anon', r.relname);
  end loop;
end $$;

-- anon column grants are subsumed by the table grant above

grant execute on all functions in schema public to public;
alter default privileges in schema public grant execute on functions to public;

-- ---- 2. restore the original permissive policies ---------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'leads','properties','assets','video_tasks','campaign_jobs',
    'campaign_analyses','qualification_forms','reference_creatives',
    'master_creatives','posts','automations','campaigns','customer_holdings',
    'distribution_batches','distribution_items','external_agents','lead_history',
    'notifications','organization_members','push_subscriptions','transactions',
    'wallet_transactions','wallets','whatsapp_broadcast_recipients',
    'whatsapp_broadcasts','whatsapp_flows','ads','creative_prompts','fractions'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', 'tenant_isolation', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant', t);
    execute format('drop policy if exists %I on public.%I', 'reference_creatives_read', t);
    execute format('drop policy if exists %I on public.%I', 'reference_creatives_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t || '_all_policy', t);
  end loop;
end $$;

drop policy if exists "posts_published_public" on public.posts;
drop policy if exists "organizations_tenant" on public.organizations;

drop policy if exists "profiles_select_policy" on public.profiles;
create policy "profiles_select_policy" on public.profiles
  for select to authenticated using (true);

-- helper functions may stay; drop them for a byte-exact revert:
drop function if exists public.is_same_tenant(uuid);
drop function if exists public.is_super_admin();
drop function if exists public.auth_org_id();
drop function if exists public.auth_agency_id();
drop function if exists public.auth_parent_id();

commit;
