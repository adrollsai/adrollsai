-- Temporary helper to allow migrating profiles into auth.users schema
CREATE OR REPLACE FUNCTION public.migrate_auth_user(
    p_id uuid,
    p_email text,
    p_raw_user_meta_data jsonb,
    p_raw_app_meta_data jsonb,
    p_email_confirmed_at timestamptz,
    p_created_at timestamptz,
    p_updated_at timestamptz
) RETURNS void AS $$
BEGIN
    INSERT INTO auth.users (
        id, email, raw_user_meta_data, raw_app_meta_data, 
        email_confirmed_at, created_at, updated_at, aud, role, is_super_admin
    ) VALUES (
        p_id, p_email, p_raw_user_meta_data, p_raw_app_meta_data, 
        p_email_confirmed_at, p_created_at, p_updated_at, 'authenticated', 'authenticated', false
    ) ON CONFLICT (id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
