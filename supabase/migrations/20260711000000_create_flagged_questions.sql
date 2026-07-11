-- Create flagged_questions table to log unanswered/unresolved questions
CREATE TABLE IF NOT EXISTS public.flagged_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
    channel TEXT NOT NULL, -- 'whatsapp' or 'voice'
    question TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    resolved BOOLEAN DEFAULT FALSE
);

-- Enable RLS
ALTER TABLE public.flagged_questions ENABLE ROW LEVEL SECURITY;

-- Create policies for select, insert, update, delete
CREATE POLICY "Allow all actions for authenticated owners" ON public.flagged_questions
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
