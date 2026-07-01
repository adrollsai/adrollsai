-- Fix instance_id for migrated auth users so GoTrue recognizes them
UPDATE auth.users
SET instance_id = '00000000-0000-0000-0000-000000000000'
WHERE instance_id IS NULL;
