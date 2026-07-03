-- Create whatsapp_flows table
CREATE TABLE IF NOT EXISTS public.whatsapp_flows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    icon_name TEXT,
    is_active BOOLEAN DEFAULT false,
    template_name TEXT,
    template_body TEXT,
    delay_minutes INTEGER DEFAULT 2,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.whatsapp_flows ENABLE ROW LEVEL SECURITY;

-- Drop policies if exists
DROP POLICY IF EXISTS "Users can manage their own whatsapp flows" ON public.whatsapp_flows;

-- Create policy
CREATE POLICY "Users can manage their own whatsapp flows" ON public.whatsapp_flows
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
