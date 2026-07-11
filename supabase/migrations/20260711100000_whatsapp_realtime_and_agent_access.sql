-- Migration: Enable WhatsApp real-time updates + agent access to assigned lead chats

-- 1. Enable Realtime for WhatsApp tables
-- Add tables to the supabase_realtime publication so postgres_changes events fire
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_chats;
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;

-- Set REPLICA IDENTITY FULL so UPDATE/DELETE events include the full row data
ALTER TABLE public.whatsapp_chats REPLICA IDENTITY FULL;
ALTER TABLE public.whatsapp_messages REPLICA IDENTITY FULL;

-- 2. Agent access RLS policies for whatsapp_chats
-- Allow agents (team members) to read chats owned by their parent admin,
-- but only for chats linked to leads assigned to them.
DROP POLICY IF EXISTS "Agents can view assigned lead chats" ON public.whatsapp_chats;
CREATE POLICY "Agents can view assigned lead chats" ON public.whatsapp_chats
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.role = 'agent'
              AND (p.parent_id = whatsapp_chats.user_id OR p.agency_id = whatsapp_chats.user_id)
              AND whatsapp_chats.lead_id IS NOT NULL
              AND EXISTS (
                  SELECT 1 FROM public.leads l
                  WHERE l.id = whatsapp_chats.lead_id
                    AND l.assigned_to = auth.uid()
              )
        )
    );

-- 3. Agent access RLS policies for whatsapp_messages
-- Allow agents to read/write messages on chats they have access to (assigned lead chats)
DROP POLICY IF EXISTS "Agents can view assigned lead chat messages" ON public.whatsapp_messages;
CREATE POLICY "Agents can view assigned lead chat messages" ON public.whatsapp_messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.whatsapp_chats c
            JOIN public.profiles p ON p.id = auth.uid()
            WHERE c.id = whatsapp_messages.chat_id
              AND p.role = 'agent'
              AND (p.parent_id = c.user_id OR p.agency_id = c.user_id)
              AND c.lead_id IS NOT NULL
              AND EXISTS (
                  SELECT 1 FROM public.leads l
                  WHERE l.id = c.lead_id
                    AND l.assigned_to = auth.uid()
              )
        )
    );

DROP POLICY IF EXISTS "Agents can insert messages on assigned lead chats" ON public.whatsapp_messages;
CREATE POLICY "Agents can insert messages on assigned lead chats" ON public.whatsapp_messages
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.whatsapp_chats c
            JOIN public.profiles p ON p.id = auth.uid()
            WHERE c.id = whatsapp_messages.chat_id
              AND p.role = 'agent'
              AND (p.parent_id = c.user_id OR p.agency_id = c.user_id)
              AND c.lead_id IS NOT NULL
              AND EXISTS (
                  SELECT 1 FROM public.leads l
                  WHERE l.id = c.lead_id
                    AND l.assigned_to = auth.uid()
              )
        )
    );
