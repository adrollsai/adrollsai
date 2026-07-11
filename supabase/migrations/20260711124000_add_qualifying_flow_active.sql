-- Migration: Add qualifying_flow_active column to whatsapp_chats
ALTER TABLE public.whatsapp_chats 
ADD COLUMN IF NOT EXISTS qualifying_flow_active BOOLEAN DEFAULT false;
