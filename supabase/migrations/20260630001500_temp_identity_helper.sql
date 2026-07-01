-- Temporary helper to allow migrating profiles into auth.identities schema
CREATE OR REPLACE FUNCTION public.migrate_auth_identity(
    p_id text,
    p_user_id uuid,
    p_identity_data jsonb,
    p_provider text,
    p_last_sign_in_at timestamptz,
    p_created_at timestamptz,
    p_updated_at timestamptz
) RETURNS void AS $$
BEGIN
    INSERT INTO auth.identities (
        id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) VALUES (
        p_id, p_user_id, p_identity_data, p_provider, p_last_sign_in_at, p_created_at, p_updated_at
    ) ON CONFLICT (provider, id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
