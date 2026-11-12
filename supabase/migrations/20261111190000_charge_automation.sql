-- ============================================================================
-- 20261111190000_charge_automation.sql
--
-- Automation metering needs its own ledger write.
--
-- `deductCredits()` in utils/credits.ts refuses to charge when
-- `subscription_status` is not one of active/trialing/pro/growth/enterprise
-- (it also carries a hardcoded 8-email whitelist). In production only 17 of 92
-- owners hold an active status, so unattended generation would be delivered but
-- never recorded in `credit_transactions` — consumption invisible, balances
-- never moving.
--
-- This function does the narrow job: atomically take `p_amount` from the paying
-- account and record it. No plan gate. Row lock prevents two concurrent runs
-- (daily creative + video) double-spending the same balance.
-- ============================================================================

begin;

create or replace function public.charge_automation(
  p_user_id     uuid,
  p_amount      numeric,
  p_description text,
  p_category    text default 'ai_generation'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner   uuid;
  v_balance numeric;
  v_zero    constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  if p_user_id is null or p_amount is null or p_amount <= 0 then
    return jsonb_build_object('charged', false, 'reason', 'invalid_request');
  end if;

  -- Team members spend the owner's balance.
  select coalesce(nullif(p.parent_id, v_zero), nullif(p.agency_id, v_zero), p.id)
    into v_owner
  from public.profiles p
  where p.id = p_user_id;

  if v_owner is null then
    return jsonb_build_object('charged', false, 'reason', 'profile_not_found');
  end if;

  -- Lock the balance row so concurrent runs cannot overdraw.
  select credits into v_balance
  from public.profiles
  where id = v_owner
  for update;

  if v_balance is null or v_balance < p_amount then
    return jsonb_build_object(
      'charged', false,
      'reason', 'insufficient_credits',
      'balance', coalesce(v_balance, 0),
      'owner', v_owner
    );
  end if;

  update public.profiles set credits = credits - p_amount where id = v_owner;

  insert into public.credit_transactions (user_id, amount, category, description)
  values (v_owner, -p_amount, coalesce(p_category, 'ai_generation'), coalesce(p_description, 'Automation'));

  return jsonb_build_object('charged', true, 'balance', v_balance - p_amount, 'owner', v_owner);
end $$;

-- `revoke ... from anon, authenticated` alone is not enough: Postgres grants EXECUTE on a
-- new function to PUBLIC by default, and anon/authenticated inherit it. Revoking PUBLIC is
-- what actually restricts this SECURITY DEFINER money-mover to the service role (which is
-- the only thing that calls it, via supabaseAdmin.rpc()).
revoke execute on function public.charge_automation(uuid, numeric, text, text) from public, anon, authenticated;
grant execute on function public.charge_automation(uuid, numeric, text, text) to service_role;

commit;
