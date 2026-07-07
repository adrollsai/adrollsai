-- Add Voice settings columns to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS elevenlabs_api_key TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS elevenlabs_agent_id TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS voice_twilio_sid TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS voice_twilio_token TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS voice_twilio_number TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS auto_call_new_leads BOOLEAN DEFAULT false;

-- Add Voice call columns to leads table
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS voice_call_status TEXT DEFAULT 'not_called';
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS voice_call_summary TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS voice_call_transcript JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS voice_recording_url TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS voice_call_id TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS voice_call_scheduled_at TIMESTAMP WITH TIME ZONE;

-- Create storage bucket for voice recordings if not exists
INSERT INTO storage.buckets (id, name, public) 
VALUES ('lead-voice-recordings', 'lead-voice-recordings', true) 
ON CONFLICT (id) DO NOTHING;

-- Storage object policies for lead voice recordings
DROP POLICY IF EXISTS "Allow Public Voice Recordings Select" ON storage.objects;
CREATE POLICY "Allow Public Voice Recordings Select" ON storage.objects
    FOR SELECT USING (bucket_id = 'lead-voice-recordings');

DROP POLICY IF EXISTS "Allow Voice Recordings Insert" ON storage.objects;
CREATE POLICY "Allow Voice Recordings Insert" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'lead-voice-recordings');
