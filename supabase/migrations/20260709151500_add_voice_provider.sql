-- Add voice_provider column to profiles table to switch between ElevenLabs and Gemini Live
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS voice_provider TEXT DEFAULT 'elevenlabs';
