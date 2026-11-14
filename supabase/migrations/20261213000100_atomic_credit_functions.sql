-- ============================================================================
-- 20261213000100_atomic_credit_functions.sql
--
-- The functions half of 20261213000000_credit_holds_and_atomic_spend.sql.
-- Split in two because the management API rejects the combined file; each half
-- applies on its own and both are idempotent (create or replace / if not exists).
--
-- Everything here moves money. Service role only. No caps. A NULL return means
-- "the balance could not cover this" and never means "charge it anyway".
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 2. Availability
-- ----------------------------------------------------------------------------
create or replace function public.available_credits(p_user_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance numeric;
  v_held    numeric;
begin
  select coalesce(p.credits, 0) into v_balance
  from public.profiles p where p.id = p_user_id;

  if v_balance is null then
    return null; -- unknown user: caller decides, do not invent a zero
  end if;

  -- Expired holds stop counting the moment they expire, even if the sweeper has
  -- not run yet.
  select coalesce(sum(h.amount - h.spent), 0) into v_held
  from public.credit_holds h
  where h.user_id = p_user_id
    and h.state = 'open'
    and (h.expires_at is null or h.expires_at > now());

  return v_balance - v_held;
end $$;

-- ----------------------------------------------------------------------------
-- 3. Reserve
-- ----------------------------------------------------------------------------
-- Returns the hold id, or NULL when the job is not funded. Returning NULL is the
-- paywall signal: the caller must not start work.
create or replace function public.reserve_credits(
  p_user_id     uuid,
  p_job_id      text,
  p_amount      numeric,
  p_ttl_minutes int default 120,
  p_reason      text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance numeric;
  v_held    numeric;
  v_hold    uuid;
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'reserve_credits: amount must be >= 0';
  end if;

  -- Lock the balance row: this is what serialises two concurrent reservations
  -- for the same wallet. Without `for update` both read the same availability.
  select coalesce(credits, 0) into v_balance
  from public.profiles where id = p_user_id
  for update;

  if v_balance is null then
    return null; -- no profile: not funded
  end if;

  -- Re-attach to an existing open hold for the same job rather than reserving
  -- twice (idempotent re-entry).
  select id into v_hold
  from public.credit_holds
  where user_id = p_user_id and job_id = p_job_id and state = 'open'
    and (expires_at is null or expires_at > now())
  limit 1;
  if v_hold is not null then
    return v_hold;
  end if;

  select coalesce(sum(amount - spent), 0) into v_held
  from public.credit_holds
  where user_id = p_user_id and state = 'open'
    and (expires_at is null or expires_at > now());

  if v_balance - v_held < p_amount then
    return null; -- paywall
  end if;

  insert into public.credit_holds (user_id, job_id, amount, reason, expires_at)
  values (
    p_user_id,
    p_job_id,
    p_amount,
    p_reason,
    case when p_ttl_minutes is null then null else now() + (p_ttl_minutes || ' minutes')::interval end
  )
  returning id into v_hold;

  return v_hold;
end $$;

-- ----------------------------------------------------------------------------
-- 4. Charge against a hold (per step, idempotent)
-- ----------------------------------------------------------------------------
-- Charges min(requested, what is left on the hold). It can never charge more
-- than the reservation, so a runaway job cannot silently overdraw the wallet —
-- it stops here and the caller has to ask for more.
create or replace function public.charge_hold(
  p_hold_id    uuid,
  p_amount     numeric,
  p_category   text default 'ai_generation',
  p_description text default null,
  p_ref        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hold      public.credit_holds;
  v_remaining numeric;
  v_charge    numeric;
  v_balance   numeric;
  v_claimed   boolean := false;
begin
  select * into v_hold from public.credit_holds where id = p_hold_id for update;
  if v_hold.id is null then
    return jsonb_build_object('ok', false, 'error', 'hold_not_found');
  end if;
  if v_hold.state <> 'open' then
    return jsonb_build_object('ok', false, 'error', 'hold_' || v_hold.state);
  end if;

  v_remaining := greatest(v_hold.amount - v_hold.spent, 0);
  v_charge    := least(greatest(coalesce(p_amount, 0), 0), v_remaining);

  if v_charge <= 0 then
    return jsonb_build_object(
      'ok', true, 'charged', 0,
      'capped', coalesce(p_amount, 0) > 0,
      'remaining', v_remaining
    );
  end if;

  -- Claim the ledger row first when a ref is supplied: the unique index decides
  -- which of two concurrent retries actually owns this step.
  if p_ref is not null then
    insert into public.credit_transactions (user_id, amount, category, description, ref)
    values (v_hold.user_id, -v_charge, p_category, coalesce(p_description, 'reserved step'), p_ref)
    on conflict (ref) where ref is not null do nothing;
    v_claimed := found;

    if not v_claimed then
      return jsonb_build_object('ok', true, 'duplicate', true, 'charged', 0,
                                'remaining', v_remaining);
    end if;
  end if;

  -- Atomic conditional decrement. NULL result = balance moved underneath us.
  update public.profiles
     set credits = coalesce(credits, 0) - v_charge
   where id = v_hold.user_id
     and coalesce(credits, 0) >= v_charge
  returning credits into v_balance;

  if v_balance is null then
    -- Give the claim back so a funded retry can still succeed later.
    if p_ref is not null then
      delete from public.credit_transactions where ref = p_ref and amount = -v_charge;
    end if;
    return jsonb_build_object('ok', false, 'error', 'insufficient_at_settle',
                              'requested', v_charge, 'remaining', v_remaining);
  end if;

  update public.credit_holds
     set spent = spent + v_charge
   where id = p_hold_id;

  if p_ref is null then
    insert into public.credit_transactions (user_id, amount, category, description)
    values (v_hold.user_id, -v_charge, p_category, coalesce(p_description, 'reserved step'));
  end if;

  return jsonb_build_object(
    'ok', true,
    'charged', v_charge,
    'balance', v_balance,
    'remaining', v_remaining - v_charge,
    'capped', coalesce(p_amount, 0) > v_charge
  );
end $$;

-- ----------------------------------------------------------------------------
-- 5. Close / release
-- ----------------------------------------------------------------------------
create or replace function public.close_hold(p_hold_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hold public.credit_holds;
begin
  select * into v_hold from public.credit_holds where id = p_hold_id for update;
  if v_hold.id is null then
    return jsonb_build_object('ok', false, 'error', 'hold_not_found');
  end if;
  if v_hold.state <> 'open' then
    return jsonb_build_object('ok', true, 'already', v_hold.state, 'spent', v_hold.spent);
  end if;

  update public.credit_holds
     set state = case when spent > 0 then 'settled' else 'released' end,
         settled_at = now(),
         reason = coalesce(p_reason, reason)
   where id = p_hold_id;

  return jsonb_build_object(
    'ok', true,
    'state', case when v_hold.spent > 0 then 'settled' else 'released' end,
    'spent', v_hold.spent,
    'released', v_hold.amount - v_hold.spent
  );
end $$;

-- Explicit release, for a cancelled or failed job. Identical to close_hold except
-- that it says so in the audit trail.
create or replace function public.release_hold(p_hold_id uuid, p_reason text default 'cancelled')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.close_hold(p_hold_id, p_reason);
end $$;

-- ----------------------------------------------------------------------------
-- 6. Spend without a hold (non-agent paths: email, one-off report)
-- ----------------------------------------------------------------------------
-- Returns the new balance, or NULL when the balance could not cover it. NULL is
-- the only failure signal; there is no partial charge.
create or replace function public.spend_credits(
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
    raise exception 'spend_credits: amount must be >= 0';
  end if;
  if p_amount = 0 then
    select coalesce(credits, 0) into v_balance from public.profiles where id = p_user_id;
    return v_balance;
  end if;

  update public.profiles
     set credits = coalesce(credits, 0) - p_amount
   where id = p_user_id
     and coalesce(credits, 0) >= p_amount
  returning credits into v_balance;

  return v_balance; -- NULL when the guard failed
end $$;

-- Atomic increment. The old read-then-write in addCredits() lost concurrent
-- top-ups: two payments landing together both read the same starting balance.
create or replace function public.add_credits_atomic(p_user_id uuid, p_amount numeric)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'add_credits_atomic: amount must be > 0';
  end if;

  update public.profiles
     set credits = coalesce(credits, 0) + p_amount
   where id = p_user_id
  returning credits into v_balance;

  return v_balance;
end $$;

-- ----------------------------------------------------------------------------
-- 7. Idempotent grant (payments)
-- ----------------------------------------------------------------------------
-- Applies a payment exactly once. Returns the new balance, or NULL when this ref
-- has already been applied — in which case the caller must return the
-- already-processed response and NOT credit again.
create or replace function public.grant_credits_once(
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
    raise exception 'grant_credits_once: a ref is required (idempotency key)';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'grant_credits_once: amount must be >= 0';
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
       set credits = coalesce(credits, 0) + p_amount
     where id = p_user_id
    returning credits into v_balance;
  else
    select coalesce(credits, 0) into v_balance from public.profiles where id = p_user_id;
  end if;

  return v_balance;
end $$;

-- ----------------------------------------------------------------------------
-- 8. Expiry sweep — an abandoned job must not hold money forever.
-- ----------------------------------------------------------------------------
create or replace function public.expire_stale_holds()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  with expired as (
    update public.credit_holds
       set state = case when spent > 0 then 'settled' else 'released' end,
           settled_at = now(),
           reason = coalesce(reason, '') || ' [expired]'
     where state = 'open'
       and expires_at is not null
       and expires_at <= now()
    returning 1
  )
  select count(*) into v_count from expired;
  return coalesce(v_count, 0);
end $$;

-- ----------------------------------------------------------------------------
-- 9. Privileges. These move money: service role only.
-- ----------------------------------------------------------------------------
revoke execute on function public.available_credits(uuid) from anon, authenticated;
revoke execute on function public.reserve_credits(uuid, text, numeric, int, text) from anon, authenticated;
revoke execute on function public.charge_hold(uuid, numeric, text, text, text) from anon, authenticated;
revoke execute on function public.close_hold(uuid, text) from anon, authenticated;
revoke execute on function public.release_hold(uuid, text) from anon, authenticated;
revoke execute on function public.spend_credits(uuid, numeric) from anon, authenticated;
revoke execute on function public.add_credits_atomic(uuid, numeric) from anon, authenticated;
revoke execute on function public.grant_credits_once(uuid, numeric, text, text, text) from anon, authenticated;
revoke execute on function public.expire_stale_holds() from anon, authenticated;

grant execute on function public.available_credits(uuid) to service_role;
grant execute on function public.reserve_credits(uuid, text, numeric, int, text) to service_role;
grant execute on function public.charge_hold(uuid, numeric, text, text, text) to service_role;
grant execute on function public.close_hold(uuid, text) to service_role;
grant execute on function public.release_hold(uuid, text) to service_role;
grant execute on function public.spend_credits(uuid, numeric) to service_role;
grant execute on function public.add_credits_atomic(uuid, numeric) to service_role;
grant execute on function public.grant_credits_once(uuid, numeric, text, text, text) to service_role;
grant execute on function public.expire_stale_holds() to service_role;

