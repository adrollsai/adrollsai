-- Create whatsapp_chats table
CREATE TABLE IF NOT EXISTS public.whatsapp_chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    recipient_phone TEXT NOT NULL,
    recipient_name TEXT,
    last_message_text TEXT,
    unread_count INTEGER DEFAULT 0 NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_user_recipient UNIQUE (user_id, recipient_phone)
);

-- Enable RLS for whatsapp_chats
ALTER TABLE public.whatsapp_chats ENABLE ROW LEVEL SECURITY;

-- Drop policy if exists and create
DROP POLICY IF EXISTS "Users can manage their own chats" ON public.whatsapp_chats;
CREATE POLICY "Users can manage their own chats" ON public.whatsapp_chats
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Create whatsapp_messages table
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id UUID NOT NULL REFERENCES public.whatsapp_chats(id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    message_text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS for whatsapp_messages
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- Drop policy if exists and create
DROP POLICY IF EXISTS "Users can manage their own chat messages" ON public.whatsapp_messages;
CREATE POLICY "Users can manage their own chat messages" ON public.whatsapp_messages
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.whatsapp_chats c
            WHERE c.id = whatsapp_messages.chat_id AND c.user_id = auth.uid()
        )
    ) WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.whatsapp_chats c
            WHERE c.id = whatsapp_messages.chat_id AND c.user_id = auth.uid()
        )
    );

-- Add whatsapp_personal_number to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS whatsapp_personal_number TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS business_landing_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS business_landing_hero_title TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS business_landing_hero_subtitle TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS business_landing_show_products BOOLEAN DEFAULT TRUE;

-- Add show_on_landing_page to properties table
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS show_on_landing_page BOOLEAN DEFAULT TRUE;
