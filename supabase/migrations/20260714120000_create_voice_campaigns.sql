-- Create voice_campaigns table to support outbound calling campaigns
CREATE TABLE IF NOT EXISTS public.voice_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    audience_filter JSONB NOT NULL, -- e.g. {"type": "all"} or {"type": "source", "value": "Facebook"}
    custom_prompt TEXT,
    status TEXT DEFAULT 'draft', -- 'draft', 'running', 'completed', 'paused'
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.voice_campaigns ENABLE ROW LEVEL SECURITY;

-- Create policy
CREATE POLICY "Allow all actions for authenticated owners" ON public.voice_campaigns
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Add voice_campaign_id to leads
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS voice_campaign_id UUID REFERENCES public.voice_campaigns(id) ON DELETE SET NULL;

-- Add language and translation columns to flagged_questions
ALTER TABLE public.flagged_questions ADD COLUMN IF NOT EXISTS language TEXT;
ALTER TABLE public.flagged_questions ADD COLUMN IF NOT EXISTS translation TEXT;

