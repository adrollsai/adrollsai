-- Add old_voice_twilio_number column to profiles to support number recovery after release
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS old_voice_twilio_number VARCHAR(50);
