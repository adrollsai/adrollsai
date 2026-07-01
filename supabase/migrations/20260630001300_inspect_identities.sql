-- Return JSON representation of auth.identities rows to check identities
CREATE OR REPLACE FUNCTION public.get_auth_identities(target_user_id uuid)
RETURNS jsonb AS $$
DECLARE
  row_data jsonb;
BEGIN
  SELECT json_agg(row_to_json(i))::jsonb INTO row_data
  FROM auth.identities i
  WHERE i.user_id = target_user_id;
  RETURN row_data;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
