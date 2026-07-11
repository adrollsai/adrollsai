-- Add enable_eod_report column to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS enable_eod_report BOOLEAN DEFAULT TRUE;
