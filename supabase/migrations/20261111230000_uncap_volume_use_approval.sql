-- ============================================================================
-- 20261111230000_uncap_volume_use_approval.sql
--
-- Volume caps were the wrong instrument. We cannot predict how much a tenant will
-- legitimately need — if a user tells the caller to call every lead in the CRM,
-- it must be able to do exactly that.
--
-- New model:
--   * NO numeric caps. A cap of 0 (or NULL) means UNLIMITED in can_spend().
--   * Approval becomes the control for large actions, not a hard ceiling.
--   * Spend is still RECORDED on every action, so usage stays visible in the
--     dashboard even though nothing blocks on it.
--
-- require_approval / approval_threshold_credits stay in place for the approval
-- path (bulk actions, e.g. "call all leads"), and are deliberately left OFF by
-- default so routine daily work is never blocked waiting for a human.
-- ============================================================================

begin;

-- 1. Zero-out every volume cap: 0 now means unlimited.
update public.tenant_automations
   set daily_credit_cap  = 0,
       daily_message_cap = 0,
       daily_call_cap    = 0;

-- 2. Make the defaults unlimited for future tenants too.
alter table public.tenant_automations
  alter column daily_credit_cap  set default 0,
  alter column daily_message_cap set default 0,
  alter column daily_call_cap    set default 0;

comment on column public.tenant_automations.daily_credit_cap is
  '0 or NULL = unlimited. Spend is still recorded in automation_spend for visibility.';
comment on column public.tenant_automations.daily_message_cap is
  '0 or NULL = unlimited. Gate volume with approval, not a hard cap.';
comment on column public.tenant_automations.daily_call_cap is
  '0 or NULL = unlimited. Gate bulk calling with approval, not a hard cap.';

-- 3. can_spend(): a non-positive cap means unlimited. Caps remain supported for
--    any tenant that explicitly wants one, but nothing is capped by default.
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
           else null
         end,
         ta.daily_credit_cap
    into v_unit_cap, v_credit_cap
  from public.tenant_automations ta
  where ta.user_id = p_user_id;

  -- No policy row at all -> allow.
  if not found then
    return jsonb_build_object('allowed', true, 'reason', 'no_policy');
  end if;

  select coalesce(sum(credits), 0), coalesce(sum(units), 0)
    into v_used_credit, v_used_units
  from public.automation_spend
  where user_id = p_user_id
    and day = (now() at time zone 'utc')::date
    and kind = p_kind;

  -- 0 / NULL => unlimited (the default).
  if v_credit_cap is not null and v_credit_cap > 0
     and v_used_credit + coalesce(p_credits, 0) > v_credit_cap then
    return jsonb_build_object('allowed', false, 'reason', 'credit_cap',
                              'used', v_used_credit, 'cap', v_credit_cap);
  end if;

  if v_unit_cap is not null and v_unit_cap > 0
     and v_used_units + coalesce(p_units, 1) > v_unit_cap then
    return jsonb_build_object('allowed', false, 'reason', 'unit_cap',
                              'used', v_used_units, 'cap', v_unit_cap);
  end if;

  return jsonb_build_object('allowed', true, 'used', v_used_credit, 'cap', v_credit_cap);
end $$;

revoke execute on function public.can_spend(uuid, text, numeric, int) from anon, authenticated;
grant execute on function public.can_spend(uuid, text, numeric, int) to service_role;

commit;
