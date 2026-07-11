-- Alter credits columns to NUMERIC to support decimal / fractional credit values
ALTER TABLE public.profiles ALTER COLUMN credits TYPE NUMERIC(10,2);
ALTER TABLE public.credit_transactions ALTER COLUMN amount TYPE NUMERIC(10,2);
