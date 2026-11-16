-- Locked calling credits, and the per-account grant.
--
-- The owner's final instruction (verbatim intent):
--   * Nobogent and Blue Square Infra  -> 25,000 credits in BOTH AI and calling
--   * GNR HOMES                       -> "afresh", i.e. the standard 3,000 AI / 2,000 calling
--   * everyone else                   -> at least 3,000 AI + 2,000 calling (the fresh 5,000)
--
-- Calling credits can only be spent on calls, at 4 credits per started minute
-- (lib/automation/call-billing.ts). They cannot pay for images, video or copy, and AI credits cannot
-- pay for calls.
--
-- ⚠️ THIS MIGRATION LOWERS TWO BALANCES. Stated openly because it is not reversible by memory:
--     Blue Square Infra  46,754 -> 25,000   (removes 21,754)
--     Nobogent           27,802 -> 25,000   (removes  2,802)
-- That is what "25000 in both" means for accounts already above it, and it is intentional. To make it
-- genuinely reversible rather than merely documented, every account's PRE-MIGRATION balance is copied
-- into public.credit_balance_backup_20261117 before anything is written. Restoring is then an UPDATE
-- from that table (statement at the bottom), not a guess.

-- ── 0. Snapshot everything first. Nothing is written until this exists. ────────────────────────────
CREATE TABLE IF NOT EXISTS public.credit_balance_backup_20261117 AS
SELECT id,
       business_name,
       COALESCE(credits, 0)         AS credits_before,
       NULL::numeric                AS calling_credits_before,  -- column does not exist yet
       NOW()                        AS snapshot_at
FROM public.profiles;

CREATE UNIQUE INDEX IF NOT EXISTS credit_balance_backup_20261117_id_idx
  ON public.credit_balance_backup_20261117 (id);

-- ── 1. The column. Default 0 so an account created before this migration cannot spend a calling ──
--       balance it does not have.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS calling_credits NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.profiles.calling_credits IS
  'Credits locked to AI calling only, at 4 credits per started minute. Cannot pay for images, video or copy.';

-- ── 2. The two named accounts: 25,000 in each pot, as instructed. ─────────────────────────────────
--       Matched by ID, not by business_name: a rename would silently stop a name match, and there are
--       near-identically named accounts this must NOT touch ("Nobogent Demo Infra", "Nobogent Test",
--       "BlueSquare Infra" — no space). IDs are stable.
--         bc63c065-… = Nobogent            (was 27,802.37)
--         2f62a259-… = Blue Square Infra   (was 46,754.76)
UPDATE public.profiles
SET credits         = 25000,
    calling_credits = 25000,
    updated_at      = NOW()
WHERE id IN (
  'bc63c065-9bcc-4793-bedc-f0960406425b',  -- Nobogent
  '2f62a259-f23b-48ee-a920-c436f36eaa4b'   -- Blue Square Infra
);

-- ── 3. GNR HOMES: "afresh" — the standard grant, not a top-up. ────────────────────────────────────
--         42d2e0c5-… = GNR HOMES (was 8,492.67)
UPDATE public.profiles
SET credits         = 3000,
    calling_credits = 2000,
    updated_at      = NOW()
WHERE id = '42d2e0c5-4fe6-4738-8a9f-63f09be01f12';  -- GNR HOMES

-- ── 4. Everyone else: RAISE to the floor, never lower. ────────────────────────────────────────────
--       A reset here would have confiscated ~93,000 credits from accounts that paid for them, most of
--       the reason this migration is explicit rather than a blanket UPDATE. The 77 zero-balance
--       accounts get exactly the fresh 5,000 "afresh" was aimed at.
UPDATE public.profiles
SET credits         = GREATEST(COALESCE(credits, 0), 3000),
    calling_credits = GREATEST(COALESCE(calling_credits, 0), 2000),
    updated_at      = NOW()
WHERE (COALESCE(credits, 0) < 3000 OR COALESCE(calling_credits, 0) < 2000)
  AND id NOT IN (
    'bc63c065-9bcc-4793-bedc-f0960406425b',
    '2f62a259-f23b-48ee-a920-c436f36eaa4b',
    '42d2e0c5-4fe6-4738-8a9f-63f09be01f12'
  );

-- ── 5. Record the calling balance each account held before this migration, for the audit trail. ───
UPDATE public.credit_balance_backup_20261117 b
SET calling_credits_before = 0
WHERE b.calling_credits_before IS NULL;

-- ── 6. Fail loudly rather than silently leaving a broken wallet. ──────────────────────────────────
DO $$
DECLARE bad INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad FROM public.profiles
   WHERE COALESCE(credits, 0) < 0 OR COALESCE(calling_credits, 0) < 0;
  IF bad > 0 THEN
    RAISE EXCEPTION 'migration left % negative credit balance(s)', bad;
  END IF;

  -- The two named accounts must end up exactly as instructed.
  SELECT COUNT(*) INTO bad FROM public.profiles
   WHERE lower(COALESCE(business_name, '')) IN ('nobogent', 'blue square infra')
     AND NOT (credits = 25000 AND calling_credits = 25000);
  IF bad > 0 THEN
    RAISE EXCEPTION 'the named accounts did not receive 25,000 + 25,000';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- TO UNDO THIS EXACTLY (every account back to its pre-migration balance):
--
--   UPDATE public.profiles p
--      SET credits = b.credits_before,
--          calling_credits = b.calling_credits_before,
--          updated_at = NOW()
--     FROM public.credit_balance_backup_20261117 b
--    WHERE p.id = b.id;
--
-- The AI-only part of any account is restored to the credit it held; the calling split is returned to
-- 0, which is what every account had before this migration existed.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
