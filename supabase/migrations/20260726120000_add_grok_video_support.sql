-- Add grok video model and voiceover audio URL support to video_tasks
ALTER TABLE public.video_tasks ADD COLUMN IF NOT EXISTS audio_url TEXT;
ALTER TABLE public.video_tasks ADD COLUMN IF NOT EXISTS video_model TEXT DEFAULT 'seedance';
