-- Migration to add whatsapp_enabled column to leads table
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS whatsapp_enabled BOOLEAN DEFAULT true;
