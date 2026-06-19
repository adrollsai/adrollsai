-- Supabase Migration: Add Google Meet link and reminder tracking columns to leads
-- Execute this script manually in the Supabase Dashboard SQL Editor.

-- Add Google Meet video link column to leads table
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS meet_link TEXT;

-- Add booking reminder sent tracking boolean to leads table
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS booking_reminder_sent BOOLEAN DEFAULT FALSE;
