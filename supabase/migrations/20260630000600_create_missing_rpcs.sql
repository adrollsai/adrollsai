-- Create custom RPC functions that were in the old database schema

-- 1. get_my_org_id
CREATE OR REPLACE FUNCTION public.get_my_org_id()
RETURNS uuid AS $$
DECLARE
  org_id uuid;
BEGIN
  SELECT organization_id INTO org_id
  FROM public.profiles
  WHERE id = auth.uid();
  RETURN org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. is_admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
DECLARE
  user_role text;
BEGIN
  SELECT role INTO user_role
  FROM public.profiles
  WHERE id = auth.uid();
  RETURN COALESCE(user_role IN ('admin', 'super_admin', 'agency'), false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. is_admin_or_agent
CREATE OR REPLACE FUNCTION public.is_admin_or_agent()
RETURNS boolean AS $$
DECLARE
  user_role text;
BEGIN
  SELECT role INTO user_role
  FROM public.profiles
  WHERE id = auth.uid();
  RETURN COALESCE(user_role IN ('admin', 'super_admin', 'agency', 'agent'), false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. get_public_org_info
CREATE OR REPLACE FUNCTION public.get_public_org_info(org_id uuid)
RETURNS TABLE(name text, logo_url text) AS $$
BEGIN
  RETURN QUERY
  SELECT o.name::text, o.master_logo_url::text AS logo_url
  FROM public.organizations o
  WHERE o.id = org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. increment_batch_counter
CREATE OR REPLACE FUNCTION public.increment_batch_counter(row_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE public.distribution_batches
  SET completed_count = COALESCE(completed_count, 0) + 1
  WHERE id = row_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. increment_share_stat
CREATE OR REPLACE FUNCTION public.increment_share_stat(asset_id uuid, platform text)
RETURNS void AS $$
BEGIN
  UPDATE public.assets
  SET share_stats = jsonb_set(
    COALESCE(share_stats, '{}'::jsonb),
    ARRAY[platform],
    (COALESCE((share_stats->>platform)::int, 0) + 1)::text::jsonb,
    true
  )
  WHERE id = asset_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. get_property_fractions_admin
CREATE OR REPLACE FUNCTION public.get_property_fractions_admin(target_property_id uuid)
RETURNS TABLE(
  doc_count bigint,
  fraction_id uuid,
  fraction_number integer,
  owner_email text,
  owner_name text,
  status text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    CASE 
      WHEN ch.documents IS NULL OR ch.documents = '' THEN 0 
      ELSE cardinality(string_to_array(ch.documents, ',')) 
    END::bigint AS doc_count,
    f.id AS fraction_id,
    f.fraction_number,
    p.email AS owner_email,
    p.business_name AS owner_name,
    f.status
  FROM public.fractions f
  LEFT JOIN public.customer_holdings ch ON ch.fraction_id = f.id
  LEFT JOIN public.profiles p ON p.id = ch.user_id
  WHERE f.property_id = target_property_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
