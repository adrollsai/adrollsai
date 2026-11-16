-- Atomic spend against the LOCKED calling pot.
--
-- The 2,000 calling credits are only worth anything if they are actually enforced. Without this,
-- `deductCredits` debits `credits` for a phone call, so a call spends AI credits and the calling pot
-- sits untouched — the split exists on the profile and nowhere in the money path.
--
-- This mirrors public.spend_credits exactly, against calling_credits instead of credits, so the
-- calling pot gets the same guarantees: a single guarded UPDATE, NULL when the balance cannot cover
-- the amount, and no read-then-write race.
--
-- They are deliberately two functions rather than one with a column name: a dynamic column in a
-- security-definer function is how a typo becomes a privilege problem.

create or replace function public.spend_calling_credits(
  p_user_id uuid,
  p_amount  numeric
)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance numeric;
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'spend_calling_credits: amount must be >= 0';
  end if;

  if p_amount = 0 then
    select coalesce(calling_credits, 0) into v_balance from public.profiles where id = p_user_id;
    return v_balance;
  end if;

  update public.profiles
     set calling_credits = coalesce(calling_credits, 0) - p_amount
   where id = p_user_id
     and coalesce(calling_credits, 0) >= p_amount
  returning calling_credits into v_balance;

  return v_balance; -- NULL when the guard failed
end $$;

-- Same privileges as spend_credits: service_role only. An anon caller must never be able to move a
-- balance.
revoke execute on function public.spend_calling_credits(uuid, numeric) from anon, authenticated;
grant  execute on function public.spend_calling_credits(uuid, numeric) to service_role;

comment on function public.spend_calling_credits(uuid, numeric) is
  'Atomic guarded decrement of profiles.calling_credits. Returns the new balance, or NULL if the pot cannot cover it.';
