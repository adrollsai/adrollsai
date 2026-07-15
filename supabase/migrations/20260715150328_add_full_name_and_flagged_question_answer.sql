-- Add full_name to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name TEXT;

-- Add answer to flagged_questions table
ALTER TABLE public.flagged_questions ADD COLUMN IF NOT EXISTS answer TEXT;
