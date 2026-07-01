-- Temporary helper to allow migrating profiles into auth.identities schema with correct types
CREATE OR REPLACE FUNCTION public.migrate_auth_identity(
    p_id uuid,
    p_user_id uuid,
    p_identity_data jsonb,
    p_provider text,
    p_provider_id text,
    p_email text,
    p_last_sign_in_at timestamptz,
    p_created_at timestamptz,
    p_updated_at timestamptz
) RETURNS void AS $$
BEGIN
    INSERT INTO auth.identities (
        id, user_id, identity_data, provider, provider_id, email, last_sign_in_at, created_at, updated_at
    ) VALUES (
        p_id, p_user_id, p_identity_data, p_provider, p_provider_id, p_email, p_last_sign_in_at, p_created_at, p_updated_at
    ) ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
