-- Add whatsapp_buttons column to profiles table to support up to 3 buttons
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS whatsapp_buttons JSONB DEFAULT '[]'::jsonb;
