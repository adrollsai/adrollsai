-- Add voice_call_retry_count column to leads table for tracking calling attempts
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS voice_call_retry_count INTEGER DEFAULT 0;
