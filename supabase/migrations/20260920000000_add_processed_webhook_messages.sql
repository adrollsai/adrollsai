-- Create table for deduplicating incoming WhatsApp/Meta webhook events across serverless invocations
CREATE TABLE IF NOT EXISTS public.processed_webhook_messages (
    message_id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for cleaning up old records if needed
CREATE INDEX IF NOT EXISTS idx_processed_webhook_messages_created_at 
ON public.processed_webhook_messages (created_at DESC);

-- Enable RLS
ALTER TABLE public.processed_webhook_messages ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
DROP POLICY IF EXISTS "Service role access for processed_webhook_messages" ON public.processed_webhook_messages;
CREATE POLICY "Service role access for processed_webhook_messages" 
ON public.processed_webhook_messages FOR ALL 
USING (true) WITH CHECK (true);
