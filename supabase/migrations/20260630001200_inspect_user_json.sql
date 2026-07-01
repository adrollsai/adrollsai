-- Return full JSON representation of auth.users row to check all columns
CREATE OR REPLACE FUNCTION public.get_auth_user_json(target_id uuid)
RETURNS jsonb AS $$
DECLARE
  row_data jsonb;
BEGIN
  SELECT row_to_json(u)::jsonb INTO row_data
  FROM auth.users u
  WHERE u.id = target_id;
  RETURN row_data;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
