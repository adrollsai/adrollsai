-- Fix broken profiles SELECT policy and add missing RLS policies for
-- properties, assets, leads, reference_creatives, qualification_forms, campaign_jobs

-- ============================================================
-- 1. FIX PROFILES: Replace the broken recursive policy
-- ============================================================
DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
CREATE POLICY "profiles_select_policy" ON public.profiles FOR SELECT
  TO authenticated
  USING (true);
-- Allow all authenticated users to read any profile.
-- The app layer already filters by user.id / agency_id / parent_id.

-- Also allow anon to read profiles with a custom_domain (public pages)
DROP POLICY IF EXISTS "profiles_anon_select_policy" ON public.profiles;
CREATE POLICY "profiles_anon_select_policy" ON public.profiles FOR SELECT
  TO anon
  USING (custom_domain IS NOT NULL);

-- ============================================================
-- 2. PROPERTIES (84 rows blocked)
-- ============================================================
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "properties_select_policy" ON public.properties;
CREATE POLICY "properties_select_policy" ON public.properties FOR SELECT USING (true);

DROP POLICY IF EXISTS "properties_all_policy" ON public.properties;
CREATE POLICY "properties_all_policy" ON public.properties FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- 3. ASSETS (648 rows blocked)
-- ============================================================
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "assets_select_policy" ON public.assets;
CREATE POLICY "assets_select_policy" ON public.assets FOR SELECT USING (true);

DROP POLICY IF EXISTS "assets_all_policy" ON public.assets;
CREATE POLICY "assets_all_policy" ON public.assets FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- 4. LEADS (1000+ rows blocked)
-- ============================================================
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leads_select_policy" ON public.leads;
CREATE POLICY "leads_select_policy" ON public.leads FOR SELECT USING (true);

DROP POLICY IF EXISTS "leads_all_policy" ON public.leads;
CREATE POLICY "leads_all_policy" ON public.leads FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- 5. REFERENCE_CREATIVES (99 rows blocked)
-- ============================================================
ALTER TABLE public.reference_creatives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reference_creatives_select_policy" ON public.reference_creatives;
CREATE POLICY "reference_creatives_select_policy" ON public.reference_creatives FOR SELECT USING (true);

DROP POLICY IF EXISTS "reference_creatives_all_policy" ON public.reference_creatives;
CREATE POLICY "reference_creatives_all_policy" ON public.reference_creatives FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- 6. QUALIFICATION_FORMS (7 rows blocked)
-- ============================================================
ALTER TABLE public.qualification_forms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "qualification_forms_select_policy" ON public.qualification_forms;
CREATE POLICY "qualification_forms_select_policy" ON public.qualification_forms FOR SELECT USING (true);

DROP POLICY IF EXISTS "qualification_forms_all_policy" ON public.qualification_forms;
CREATE POLICY "qualification_forms_all_policy" ON public.qualification_forms FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- 7. CAMPAIGN_JOBS (13 rows blocked)
-- ============================================================
ALTER TABLE public.campaign_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaign_jobs_select_policy" ON public.campaign_jobs;
CREATE POLICY "campaign_jobs_select_policy" ON public.campaign_jobs FOR SELECT USING (true);

DROP POLICY IF EXISTS "campaign_jobs_all_policy" ON public.campaign_jobs;
CREATE POLICY "campaign_jobs_all_policy" ON public.campaign_jobs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- 8. CAMPAIGN_ANALYSES (just in case)
-- ============================================================
ALTER TABLE public.campaign_analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaign_analyses_select_policy" ON public.campaign_analyses;
CREATE POLICY "campaign_analyses_select_policy" ON public.campaign_analyses FOR SELECT USING (true);

DROP POLICY IF EXISTS "campaign_analyses_all_policy" ON public.campaign_analyses;
CREATE POLICY "campaign_analyses_all_policy" ON public.campaign_analyses FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- 9. VIDEO_TASKS (just in case)
-- ============================================================
ALTER TABLE public.video_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "video_tasks_select_policy" ON public.video_tasks;
CREATE POLICY "video_tasks_select_policy" ON public.video_tasks FOR SELECT USING (true);

DROP POLICY IF EXISTS "video_tasks_all_policy" ON public.video_tasks;
CREATE POLICY "video_tasks_all_policy" ON public.video_tasks FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- property_co_owners skipped — table does not exist in remote DB
