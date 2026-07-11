-- Add whatsapp_catalogue_button_text column to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS whatsapp_catalogue_button_text TEXT DEFAULT 'View Products';
