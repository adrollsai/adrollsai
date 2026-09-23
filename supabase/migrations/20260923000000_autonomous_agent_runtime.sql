-- Migration: Autonomous Agent Runtime Tables & Lead Columns
-- Enables Goal-Driven Autonomous Sales, Event-Driven Watchdogs, and Call-to-WhatsApp Handshakes

-- 1. Agent Policies Table
CREATE TABLE IF NOT EXISTS public.agent_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    is_enabled BOOLEAN DEFAULT true,
    contact_intensity TEXT DEFAULT 'medium', -- 'low', 'medium', 'high'
    business_hours_start TEXT DEFAULT '09:30',
    business_hours_end TEXT DEFAULT '19:00',
    timezone TEXT DEFAULT 'Asia/Kolkata',
    max_calls_per_lead INT DEFAULT 2,
    max_whatsapp_attempts INT DEFAULT 4,
    calling_enabled BOOLEAN DEFAULT true,
    whatsapp_enabled BOOLEAN DEFAULT true,
    appointment_goal TEXT DEFAULT 'site_visit', -- 'site_visit', 'consultation', 'demo', 'call'
    slot_duration_mins INT DEFAULT 45,
    tone TEXT DEFAULT 'consultative', -- 'consultative', 'direct', 'friendly'
    custom_instructions TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT agent_policies_user_id_unique UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_policies_user_id ON public.agent_policies(user_id);
ALTER TABLE public.agent_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role access for agent_policies" ON public.agent_policies;
CREATE POLICY "Service role access for agent_policies" ON public.agent_policies FOR ALL USING (true) WITH CHECK (true);

-- 2. Agent Events Queue Table (Event-Driven Wake-Up & Watchdog)
CREATE TABLE IF NOT EXISTS public.agent_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL, -- 'RE_EVALUATE', 'FOLLOWUP_CALL', 'FOLLOWUP_WHATSAPP', 'WATCHDOG_CHECK', 'BATCH_IMPORT_START'
    scheduled_for TIMESTAMPTZ NOT NULL,
    payload JSONB DEFAULT '{}'::jsonb,
    status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed', 'cancelled'
    attempts INT DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_events_scheduled_status 
ON public.agent_events(scheduled_for, status);

CREATE INDEX IF NOT EXISTS idx_agent_events_lead_id 
ON public.agent_events(lead_id);

ALTER TABLE public.agent_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role access for agent_events" ON public.agent_events;
CREATE POLICY "Service role access for agent_events" ON public.agent_events FOR ALL USING (true) WITH CHECK (true);

-- 3. Agent Pending Deliveries (Call-to-WhatsApp Handshake Queue)
CREATE TABLE IF NOT EXISTS public.agent_pending_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    requested_items JSONB NOT NULL DEFAULT '[]'::jsonb,
    custom_message TEXT,
    status TEXT DEFAULT 'waiting_handshake', -- 'waiting_handshake', 'delivered', 'expired'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    delivered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_pending_deliveries_lead_status 
ON public.agent_pending_deliveries(lead_id, status);

ALTER TABLE public.agent_pending_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role access for agent_pending_deliveries" ON public.agent_pending_deliveries;
CREATE POLICY "Service role access for agent_pending_deliveries" ON public.agent_pending_deliveries FOR ALL USING (true) WITH CHECK (true);

-- 4. Enrich Leads Table with Agent Columns
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'autonomous_status') THEN
        ALTER TABLE public.leads ADD COLUMN autonomous_status TEXT DEFAULT 'NEW';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'last_agent_thought') THEN
        ALTER TABLE public.leads ADD COLUMN last_agent_thought TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'next_action_due_at') THEN
        ALTER TABLE public.leads ADD COLUMN next_action_due_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'processing_lock_until') THEN
        ALTER TABLE public.leads ADD COLUMN processing_lock_until TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'whatsapp_window_expires_at') THEN
        ALTER TABLE public.leads ADD COLUMN whatsapp_window_expires_at TIMESTAMPTZ;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_leads_next_action_due 
ON public.leads(next_action_due_at) 
WHERE next_action_due_at IS NOT NULL;
