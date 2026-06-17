-- Add campaign-specific flow columns and variable mapping support to whatsapp_flows
ALTER TABLE public.whatsapp_flows 
ADD COLUMN IF NOT EXISTS campaign_name TEXT DEFAULT 'All',
ADD COLUMN IF NOT EXISTS variables_mapping JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS header_media_url TEXT;

-- Create index for faster campaign drip matching
CREATE INDEX IF NOT EXISTS idx_whatsapp_flows_campaign ON public.whatsapp_flows(user_id, campaign_name, is_active);
