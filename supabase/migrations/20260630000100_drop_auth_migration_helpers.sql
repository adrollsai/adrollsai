-- Drop temporary Auth Migration Helper RPC Functions to clean up public schema

DROP FUNCTION IF EXISTS public.migrate_auth_user(uuid, text, jsonb, jsonb, timestamptz, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.migrate_auth_identity(text, uuid, jsonb, text, timestamptz, timestamptz, timestamptz);
