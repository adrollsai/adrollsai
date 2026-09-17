-- Add client_features to profiles for per-client feature access control
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS client_features JSONB DEFAULT NULL;

-- Ensure whitelabel_domain index exists for fast lookup
CREATE INDEX IF NOT EXISTS idx_profiles_whitelabel_domain ON public.profiles(whitelabel_domain) WHERE whitelabel_domain IS NOT NULL;

-- Allow anon to read profiles with whitelabel_domain or custom_domain
DROP POLICY IF EXISTS "profiles_anon_select_policy" ON public.profiles;
CREATE POLICY "profiles_anon_select_policy" ON public.profiles FOR SELECT
  TO anon
  USING (custom_domain IS NOT NULL OR whitelabel_domain IS NOT NULL);
