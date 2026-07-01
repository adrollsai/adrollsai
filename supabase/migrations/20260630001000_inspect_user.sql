-- Temporary inspect function to query columns of auth.users
CREATE OR REPLACE FUNCTION public.get_any_auth_user(target_id uuid)
RETURNS TABLE (
    id uuid,
    email varchar,
    instance_id uuid,
    aud varchar,
    role varchar,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    is_super_admin bool,
    created_at timestamptz
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.id, u.email, u.instance_id, u.aud, u.role, 
        u.raw_app_meta_data, u.raw_user_meta_data, u.is_super_admin, u.created_at
    FROM auth.users u
    WHERE u.id = target_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
