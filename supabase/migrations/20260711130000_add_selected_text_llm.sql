-- Migration: Add selected_text_llm column to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS selected_text_llm TEXT DEFAULT 'gemini';
