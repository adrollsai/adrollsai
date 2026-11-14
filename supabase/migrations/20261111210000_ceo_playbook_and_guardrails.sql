-- ============================================================================
-- 20261111210000_ceo_playbook_and_guardrails.sql
--
-- The CEO needs a durable, versioned set of decisions it made for each tenant —
-- what website to build, what the call script says, what the WhatsApp replies
-- say (including the three mandatory reply buttons and their context-specific
-- labels) — plus hard budgets so autonomy cannot run away with real money.
--
-- Design note: the playbook is GENERATED ONCE, FROZEN, then VERSIONED. Every
-- send/call reads the active version. Freezing is what makes the behaviour
-- explainable ("why did my bot say that?") and editable without brand drift.
-- ============================================================================

begin;

create table if not exists public.business_playbooks (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  version         int  not null default 1,
  status          text not null default 'draft',      -- draft | active | archived

  -- CEO-authored decisions
  industry        text,
  positioning     text,                                -- one-line what this business is
  website_spec    jsonb not null default '{}'::jsonb,  -- sections, copy direction, assets
  call_script     jsonb not null default '{}'::jsonb,  -- opening / qualify / objection / close
  whatsapp_replies jsonb not null default '{}'::jsonb, -- first_reply / followup / catalogue / booking
  buttons         jsonb not null default '{}'::jsonb,  -- the 3 mandatory reply buttons + labels
  cadence         jsonb not null default '{}'::jsonb,

  authored_by     text not null default 'ceo',         -- ceo | user
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists business_playbooks_user_version_idx
  on public.business_playbooks (user_id, version);

-- Exactly one active version per tenant.
create unique index if not exists business_playbooks_one_active_idx
  on public.business_playbooks (user_id)
  where status = 'active';

alter table public.business_playbooks enable row level security;

drop policy if exists "business_playbooks_owner" on public.business_playbooks;
create policy "business_playbooks_owner" on public.business_playbooks
  for all to authenticated
  using (user_id = auth.uid() or public.is_same_tenant(user_id))
  with check (user_id = auth.uid() or public.is_same_tenant(user_id));

grant select, insert, update on public.business_playbooks to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Guardrails. Autonomy without budgets is how an agent spends a customer's
-- credits overnight, so these are enforced in code before every paid or
-- customer-facing action.
-- ---------------------------------------------------------------------------
alter table public.tenant_automations
  add column if not exists daily_credit_cap        numeric not null default 500,
  add column if not exists daily_message_cap       int     not null default 200,
  add column if not exists daily_call_cap          int     not null default 50,
  add column if not exists require_approval        boolean not null default false,
  add column if not exists approval_threshold_credits numeric not null default 250,
  add column if not exists outbound_test_mode      boolean not null default false;

-- ---------------------------------------------------------------------------
-- Daily spend ledger so caps are enforced against reality, not guesses.
-- ---------------------------------------------------------------------------
create table if not exists public.automation_spend (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  day         date not null default (now() at time zone 'utc')::date,
  kind        text not null,          -- creative | video | call | message
  credits     numeric not null default 0,
  units       int not null default 1,
  created_at  timestamptz not null default now()
);

create index if not exists automation_spend_user_day_idx
  on public.automation_spend (user_id, day, kind);

alter table public.automation_spend enable row level security;
drop policy if exists "automation_spend_owner_read" on public.automation_spend;
create policy "automation_spend_owner_read" on public.automation_spend
  for select to authenticated
  using (user_id = auth.uid() or public.is_same_tenant(user_id));
grant select on public.automation_spend to authenticated;
grant all on public.automation_spend to service_role;

-- Atomic guard: returns whether this action is inside today's caps.
create or replace function public.can_spend(
  p_user_id uuid,
  p_kind    text,
  p_credits numeric default 0,
  p_units   int default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_credit_cap  numeric;
  v_unit_cap    int;
  v_used_credit numeric;
  v_used_units  int;
begin
  select case p_kind
           when 'call'    then ta.daily_call_cap
           when 'message' then ta.daily_message_cap
           else 1000000
         end,
         ta.daily_credit_cap
    into v_unit_cap, v_credit_cap
  from public.tenant_automations ta
  where ta.user_id = p_user_id;

  if v_credit_cap is null then
    return jsonb_build_object('allowed', true, 'reason', 'no_policy');
  end if;

  select coalesce(sum(credits), 0), coalesce(sum(units), 0)
    into v_used_credit, v_used_units
  from public.automation_spend
  where user_id = p_user_id
    and day = (now() at time zone 'utc')::date
    and kind = p_kind;

  if v_used_credit + coalesce(p_credits, 0) > v_credit_cap then
    return jsonb_build_object('allowed', false, 'reason', 'credit_cap',
                              'used', v_used_credit, 'cap', v_credit_cap);
  end if;

  if v_used_units + coalesce(p_units, 1) > v_unit_cap then
    return jsonb_build_object('allowed', false, 'reason', 'unit_cap',
                              'used', v_used_units, 'cap', v_unit_cap);
  end if;

  return jsonb_build_object('allowed', true, 'used', v_used_credit, 'cap', v_credit_cap);
end $$;

revoke execute on function public.can_spend(uuid, text, numeric, int) from anon, authenticated;
grant execute on function public.can_spend(uuid, text, numeric, int) to service_role;

commit;
