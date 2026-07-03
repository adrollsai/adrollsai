-- Add property relationship columns to existing tables
ALTER TABLE public.whatsapp_flows 
ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL;

ALTER TABLE public.leads 
ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL;

ALTER TABLE public.landing_pages 
ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL;

-- Create whatsapp_broadcasts table
CREATE TABLE IF NOT EXISTS public.whatsapp_broadcasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,
    template_name TEXT NOT NULL,
    recipient_stage TEXT DEFAULT 'All',
    recipient_property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
    scheduled_at TIMESTAMP WITH TIME ZONE,
    sent_at TIMESTAMP WITH TIME ZONE,
    status TEXT DEFAULT 'pending' NOT NULL, -- 'pending', 'processing', 'sent', 'failed'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS for broadcasts
ALTER TABLE public.whatsapp_broadcasts ENABLE ROW LEVEL SECURITY;

-- Drop policy if exists and create
DROP POLICY IF EXISTS "Users can manage their own broadcasts" ON public.whatsapp_broadcasts;
CREATE POLICY "Users can manage their own broadcasts" ON public.whatsapp_broadcasts
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Create whatsapp_broadcast_recipients table
CREATE TABLE IF NOT EXISTS public.whatsapp_broadcast_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    broadcast_id UUID REFERENCES public.whatsapp_broadcasts(id) ON DELETE CASCADE NOT NULL,
    lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL, -- De-normalized user_id for fast policy checks
    phone_number TEXT NOT NULL,
    status TEXT DEFAULT 'pending' NOT NULL, -- 'pending', 'sent', 'failed'
    sent_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS for broadcast recipients
ALTER TABLE public.whatsapp_broadcast_recipients ENABLE ROW LEVEL SECURITY;

-- Drop policy if exists and create
DROP POLICY IF EXISTS "Users can manage their own broadcast recipients" ON public.whatsapp_broadcast_recipients;
CREATE POLICY "Users can manage their own broadcast recipients" ON public.whatsapp_broadcast_recipients
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
