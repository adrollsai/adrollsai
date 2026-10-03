-- Migration: 20261002000000_create_gbp_audits.sql
-- Description: Create gbp_audit_campaigns and gbp_audit_reports for Google Business Profile Auditing & White-label Lead Generation

-- 1. Campaign configurations for Super Admin & Agency Owners
CREATE TABLE IF NOT EXISTS public.gbp_audit_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  slug TEXT UNIQUE NOT NULL,
  agency_name TEXT NOT NULL DEFAULT 'Nobogent Partner',
  logo_url TEXT,
  hero_title TEXT DEFAULT 'Get Your Free Google Business Profile & Local Ranking Audit',
  hero_subtitle TEXT DEFAULT 'Discover why competitors are outranking you on Google Maps, find your lost revenue, and get an AI-powered roadmap in 60 seconds.',
  cta_text TEXT DEFAULT 'Book A Free Strategy Call',
  cta_url TEXT DEFAULT '',
  support_phone TEXT DEFAULT '',
  support_email TEXT DEFAULT '',
  brand_color TEXT DEFAULT '#2563EB',
  target_industry TEXT DEFAULT 'General',
  enabled_modes JSONB DEFAULT '["instant_search", "google_oauth"]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index on campaign slug
CREATE INDEX IF NOT EXISTS idx_gbp_audit_campaigns_slug ON public.gbp_audit_campaigns(slug);
CREATE INDEX IF NOT EXISTS idx_gbp_audit_campaigns_user_id ON public.gbp_audit_campaigns(user_id);

-- 2. Audit reports table
CREATE TABLE IF NOT EXISTS public.gbp_audit_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES public.gbp_audit_campaigns(id) ON DELETE SET NULL,
  agency_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  campaign_slug TEXT,
  business_name TEXT NOT NULL,
  place_id TEXT,
  address TEXT,
  phone TEXT,
  website TEXT,
  primary_category TEXT,
  secondary_categories TEXT[] DEFAULT '{}',
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  rating NUMERIC(3, 2),
  reviews_count INTEGER DEFAULT 0,
  lead_name TEXT,
  lead_email TEXT,
  lead_phone TEXT,
  overall_score INTEGER DEFAULT 50,
  score_grade TEXT DEFAULT 'Needs Improvement',
  estimated_monthly_loss NUMERIC DEFAULT 40000,
  currency TEXT DEFAULT 'INR',
  executive_summary TEXT,
  checklist_items JSONB DEFAULT '[]'::jsonb,
  competitors JSONB DEFAULT '[]'::jsonb,
  action_plan JSONB DEFAULT '{}'::jsonb,
  target_keywords JSONB DEFAULT '[]'::jsonb,
  heatmaps JSONB DEFAULT '{}'::jsonb,
  google_access_token TEXT,
  google_refresh_token TEXT,
  google_account_id TEXT,
  google_location_id TEXT,
  share_token TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'completed',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_gbp_audit_reports_share_token ON public.gbp_audit_reports(share_token);
CREATE INDEX IF NOT EXISTS idx_gbp_audit_reports_agency_user_id ON public.gbp_audit_reports(agency_user_id);
CREATE INDEX IF NOT EXISTS idx_gbp_audit_reports_campaign_slug ON public.gbp_audit_reports(campaign_slug);

-- RLS Policies
ALTER TABLE public.gbp_audit_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gbp_audit_reports ENABLE ROW LEVEL SECURITY;

-- Campaign policies
DROP POLICY IF EXISTS "gbp_campaigns_public_select" ON public.gbp_audit_campaigns;
CREATE POLICY "gbp_campaigns_public_select" ON public.gbp_audit_campaigns
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "gbp_campaigns_owner_all" ON public.gbp_audit_campaigns;
CREATE POLICY "gbp_campaigns_owner_all" ON public.gbp_audit_campaigns
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Report policies: Public can read by share_token, anon can insert new audit, owner can read all their reports
DROP POLICY IF EXISTS "gbp_reports_public_select" ON public.gbp_audit_reports;
CREATE POLICY "gbp_reports_public_select" ON public.gbp_audit_reports
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "gbp_reports_public_insert" ON public.gbp_audit_reports;
CREATE POLICY "gbp_reports_public_insert" ON public.gbp_audit_reports
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "gbp_reports_owner_update" ON public.gbp_audit_reports;
CREATE POLICY "gbp_reports_owner_update" ON public.gbp_audit_reports
  FOR UPDATE TO authenticated
  USING (auth.uid() = agency_user_id)
  WITH CHECK (auth.uid() = agency_user_id);
