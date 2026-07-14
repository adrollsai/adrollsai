-- Add accepted_terms column to profiles to enforce legal agreement acceptance
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS accepted_terms BOOLEAN DEFAULT false;
