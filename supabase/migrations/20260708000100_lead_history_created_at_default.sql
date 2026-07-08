-- Set default value for created_at in lead_history to now() so that logs are properly sorted by time
ALTER TABLE public.lead_history ALTER COLUMN created_at SET DEFAULT now();
UPDATE public.lead_history SET created_at = now() WHERE created_at IS NULL;
