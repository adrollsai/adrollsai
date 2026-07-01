-- Drop all temporary diagnostic inspect functions for database security
DROP FUNCTION IF EXISTS public.get_any_auth_user(uuid);
DROP FUNCTION IF EXISTS public.get_auth_user_json(uuid);
DROP FUNCTION IF EXISTS public.get_auth_identities(uuid);
DROP FUNCTION IF EXISTS public.get_auth_identities_json(uuid);
DROP FUNCTION IF EXISTS public.get_identities_columns();
DROP FUNCTION IF EXISTS public.get_identities_indexes();
DROP FUNCTION IF EXISTS public.get_users_columns();
DROP FUNCTION IF EXISTS public.migrate_auth_identity(uuid, uuid, jsonb, text, text, text, timestamptz, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.migrate_auth_identity(uuid, uuid, jsonb, text, text, timestamptz, timestamptz, timestamptz);
