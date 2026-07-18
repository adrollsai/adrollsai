-- Add media support columns to whatsapp_messages
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS media_type TEXT;

-- Allow message_text to be nullable (for pure image/media messages with no caption)
ALTER TABLE public.whatsapp_messages ALTER COLUMN message_text DROP NOT NULL;
