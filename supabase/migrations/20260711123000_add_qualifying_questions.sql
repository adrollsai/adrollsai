-- Migration: Add qualifying questions and toggle to profiles table
ALTER TABLE public.profiles 
ADD COLUMN qualifying_enabled BOOLEAN DEFAULT false,
ADD COLUMN qualifying_questions TEXT[] DEFAULT '{}'::TEXT[];
