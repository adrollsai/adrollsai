-- Supabase Migration: Add Google Calendar Booking columns
-- Execute this script manually in the Supabase Dashboard SQL Editor.

-- 1. Add connection and settings columns to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS google_refresh_token TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS google_booking_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS google_booking_duration INTEGER DEFAULT 30;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS google_booking_hours JSONB DEFAULT '{"start": "09:00", "end": "17:00"}'::jsonb;

-- 2. Add scheduling activation toggle to landing_pages table
ALTER TABLE public.landing_pages ADD COLUMN IF NOT EXISTS booking_enabled BOOLEAN DEFAULT FALSE;

-- 3. Add appointment slot timestamp to leads table
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS booked_time TIMESTAMPTZ;
