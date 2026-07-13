-- Performance indexes for SaaS scale operations
CREATE INDEX IF NOT EXISTS idx_leads_voice_call_scheduled 
ON public.leads USING btree (voice_call_scheduled_at, calling_enabled, voice_call_status);

CREATE INDEX IF NOT EXISTS idx_leads_user_id 
ON public.leads USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_chat 
ON public.whatsapp_messages USING btree (chat_id, created_at DESC);
