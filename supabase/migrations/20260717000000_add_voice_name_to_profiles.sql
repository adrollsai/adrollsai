-- Add voice_name column to profiles table to select universal voice tone
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS voice_name TEXT DEFAULT 'Aoede';
