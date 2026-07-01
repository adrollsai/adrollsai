-- Drop temporary helper function after use for safety
DROP FUNCTION IF EXISTS public.migrate_auth_user(uuid, text, jsonb, jsonb, timestamptz, timestamptz, timestamptz);
