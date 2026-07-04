-- Create whatsapp_question_flows table
CREATE TABLE IF NOT EXISTS public.whatsapp_question_flows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    questions JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT false,
    linked_campaign_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.whatsapp_question_flows ENABLE ROW LEVEL SECURITY;

-- RLS Policy
DROP POLICY IF EXISTS "Users can manage their own question flows" ON public.whatsapp_question_flows;
CREATE POLICY "Users can manage their own question flows" ON public.whatsapp_question_flows
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Add flow state columns to whatsapp_chats
ALTER TABLE public.whatsapp_chats ADD COLUMN IF NOT EXISTS current_flow_id UUID REFERENCES public.whatsapp_question_flows(id) ON DELETE SET NULL;
ALTER TABLE public.whatsapp_chats ADD COLUMN IF NOT EXISTS current_question_index INTEGER DEFAULT 0;
ALTER TABLE public.whatsapp_chats ADD COLUMN IF NOT EXISTS flow_answers JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.whatsapp_chats ADD COLUMN IF NOT EXISTS flow_completed BOOLEAN DEFAULT false;
ALTER TABLE public.whatsapp_chats ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL;
