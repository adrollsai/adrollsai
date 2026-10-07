-- Migration: 20261007150000_gbp_optimization_and_missed_call.sql
-- Description: Tables and columns for GBP Optimization Suite, Review Gating, and Missed Call Text Back

-- 1. Create table for GBP Posts (Updates, Offers, Events)
CREATE TABLE IF NOT EXISTS public.gbp_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  post_type TEXT NOT NULL DEFAULT 'update', -- 'update', 'offer', 'event'
  summary TEXT NOT NULL,
  call_to_action_type TEXT DEFAULT 'LEARN_MORE', -- 'BOOK', 'CALL', 'LEARN_MORE', 'ORDER', 'SIGN_UP'
  call_to_action_url TEXT,
  media_url TEXT,
  offer_coupon_code TEXT,
  offer_terms TEXT,
  event_title TEXT,
  event_start_time TIMESTAMPTZ,
  event_end_time TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'published', -- 'draft', 'scheduled', 'published', 'failed'
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ DEFAULT now(),
  google_post_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gbp_posts_user_id ON public.gbp_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_gbp_posts_status ON public.gbp_posts(status);

-- 2. Create table for Review Private Feedbacks (<4 stars gating)
CREATE TABLE IF NOT EXISTS public.review_feedbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  customer_name TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  feedback TEXT NOT NULL,
  source TEXT DEFAULT 'review_gate',
  status TEXT DEFAULT 'new', -- 'new', 'in_progress', 'resolved'
  resolution_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_feedbacks_user_id ON public.review_feedbacks(user_id);
CREATE INDEX IF NOT EXISTS idx_review_feedbacks_status ON public.review_feedbacks(status);

-- 3. Add columns to profiles for GBP & Missed Call Text Back
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS google_place_id TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS google_review_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS missed_call_textback_enabled BOOLEAN DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS missed_call_platform TEXT DEFAULT 'twilio'; -- 'twilio' or 'whatsapp'
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS missed_call_flow_type TEXT DEFAULT 'booking_link'; -- 'booking_link', 'interactive_flow', 'custom_message'
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS missed_call_custom_template TEXT;

-- 4. Enable RLS
ALTER TABLE public.gbp_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_feedbacks ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
DROP POLICY IF EXISTS "gbp_posts_owner_all" ON public.gbp_posts;
CREATE POLICY "gbp_posts_owner_all" ON public.gbp_posts
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "review_feedbacks_public_insert" ON public.review_feedbacks;
CREATE POLICY "review_feedbacks_public_insert" ON public.review_feedbacks
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "review_feedbacks_owner_select" ON public.review_feedbacks;
CREATE POLICY "review_feedbacks_owner_select" ON public.review_feedbacks
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "review_feedbacks_owner_update" ON public.review_feedbacks;
CREATE POLICY "review_feedbacks_owner_update" ON public.review_feedbacks
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
