-- Atomic, idempotent grant into the LOCKED calling pot.
--
-- Mirrors public.grant_credits_once exactly, against calling_credits instead of credits — same
-- unique-ref claim in credit_transactions, so a retried payment or a replayed webhook credits the pot
-- once and only once. Needed because the trial now splits 1,000 credits into 600 AI + 400 calling:
-- two pots, two grants, and each must be individually idempotent.

create or replace function public.grant_calling_credits_once(
  p_user_id     uuid,
  p_amount      numeric,
  p_category    text,
  p_description text,
  p_ref         text
)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance numeric;
  v_claimed boolean := false;
begin
  if p_ref is null or length(p_ref) = 0 then
    raise exception 'grant_calling_credits_once: a ref is required (idempotency key)';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'grant_calling_credits_once: amount must be >= 0';
  end if;

  -- Claim first. The unique index on ref is the lock: exactly one caller wins.
  begin
    insert into public.credit_transactions (user_id, amount, category, description, ref)
    values (p_user_id, p_amount, p_category, p_description, p_ref);
    v_claimed := true;
  exception when unique_violation then
    v_claimed := false;
  end;

  if not v_claimed then
    return null; -- already granted
  end if;

  if p_amount > 0 then
    update public.profiles
       set calling_credits = coalesce(calling_credits, 0) + p_amount
     where id = p_user_id
    returning calling_credits into v_balance;
  else
    select coalesce(calling_credits, 0) into v_balance from public.profiles where id = p_user_id;
  end if;

  return v_balance;
end $$;

revoke execute on function public.grant_calling_credits_once(uuid, numeric, text, text, text) from anon, authenticated;
grant  execute on function public.grant_calling_credits_once(uuid, numeric, text, text, text) to service_role;

comment on function public.grant_calling_credits_once(uuid, numeric, text, text, text) is
  'Idempotent grant into profiles.calling_credits, keyed on credit_transactions.ref.';
