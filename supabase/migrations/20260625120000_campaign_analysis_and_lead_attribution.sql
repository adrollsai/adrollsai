-- 1. Create campaign_analyses table
CREATE TABLE IF NOT EXISTS public.campaign_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  campaign_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  metrics JSONB NOT NULL,
  analysis_text TEXT NOT NULL,
  recommendations JSONB NOT NULL
);

-- 2. Enable RLS on the new table
ALTER TABLE public.campaign_analyses ENABLE ROW LEVEL SECURITY;

-- 3. Create policies for user-specific access (supporting super admin and agency impersonation)
CREATE POLICY select_campaign_analyses ON public.campaign_analyses
  FOR SELECT TO authenticated USING (
    auth.uid() = user_id OR 
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() 
      AND (agency_id = public.campaign_analyses.user_id OR parent_id = public.campaign_analyses.user_id OR role = 'super_admin')
    ) OR
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = public.campaign_analyses.user_id 
      AND (agency_id = auth.uid())
    )
  );
  
CREATE POLICY insert_campaign_analyses ON public.campaign_analyses
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = user_id OR 
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() 
      AND (agency_id = public.campaign_analyses.user_id OR parent_id = public.campaign_analyses.user_id OR role = 'super_admin')
    ) OR
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = public.campaign_analyses.user_id 
      AND (agency_id = auth.uid())
    )
  );
  
CREATE POLICY delete_campaign_analyses ON public.campaign_analyses
  FOR DELETE TO authenticated USING (
    auth.uid() = user_id OR 
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() 
      AND (agency_id = public.campaign_analyses.user_id OR parent_id = public.campaign_analyses.user_id OR role = 'super_admin')
    ) OR
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = public.campaign_analyses.user_id 
      AND (agency_id = auth.uid())
    )
  );


-- 4. Add campaign_id column to leads table
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS campaign_id TEXT;
