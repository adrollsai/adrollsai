-- Add default value for created_at in assets table if not set
ALTER TABLE public.assets ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());

-- Backfill any assets that have null created_at values to current time so they sort properly
UPDATE public.assets SET created_at = timezone('utc'::text, now()) WHERE created_at IS NULL;
