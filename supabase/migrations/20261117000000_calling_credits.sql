-- Locked calling credits, and the "5,000 afresh" grant.
--
-- The owner's rule: every account gets 5,000 credits split 3,000 AI / 2,000 calling, and the
-- calling credits can only be spent on calls (4 credits per started minute — see
-- lib/automation/call-billing.ts).
--
-- ⚠️ WHY THIS IS A FLOOR AND NOT A RESET
-- "Give everyone 5000 credits afresh" reads like `credits = 3000, calling_credits = 2000`. That
-- statement was written before looking at the data. It is not safe:
--
--   Blue Square Infra   46,754 credits
--   Nobogent            27,802 credits
--   GNR HOMES            8,493 credits
--   16 other accounts    between 1 and 4,999
--   77 accounts          0
--   total held          113,939
--
-- A reset would confiscate roughly 93,000 credits, most of it from three accounts that paid for it.
-- Deleting a customer's paid balance is not a pricing decision, so this migration RAISES balances to
-- the floor and never lowers one. The 77 zero-balance accounts get exactly the fresh 5,000 the owner
-- asked for, which is who "afresh" was really aimed at.
--
-- If a true reset IS wanted, it is the commented statement at the bottom — run it deliberately, after
-- deciding what those three accounts are owed.

-- 1. The column. Default 0 so an account created before this migration cannot accidentally spend a
--    calling balance it does not have.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS calling_credits NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.profiles.calling_credits IS
  'Credits locked to AI calling only, at 4 credits per started minute. Cannot pay for images, video or copy.';

-- 2. Raise every account to at least 3,000 AI + 2,000 calling. Never reduces anything.
UPDATE public.profiles
SET credits         = GREATEST(COALESCE(credits, 0), 3000),
    calling_credits = GREATEST(COALESCE(calling_credits, 0), 2000),
    updated_at      = NOW()
WHERE COALESCE(credits, 0) < 3000
   OR COALESCE(calling_credits, 0) < 2000;

-- 3. Prove the invariant the application will rely on: no negative balances.
DO $$
DECLARE bad INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad FROM public.profiles
   WHERE COALESCE(credits, 0) < 0 OR COALESCE(calling_credits, 0) < 0;
  IF bad > 0 THEN
    RAISE EXCEPTION 'migration left % negative credit balance(s)', bad;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- NOT RUN. The literal "reset everyone to 5,000" version. It destroys paid inventory:
--
--   UPDATE public.profiles SET credits = 3000, calling_credits = 2000, updated_at = NOW();
--
-- Run it only after explicitly deciding what Blue Square Infra (46,754), Nobogent (27,802) and
-- GNR HOMES (8,493) are owed in exchange.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
