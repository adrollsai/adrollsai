-- Clean up duplicate user_id + slug combinations by keeping only the latest updated_at
DELETE FROM public.landing_pages
WHERE id NOT IN (
    SELECT DISTINCT ON (user_id, slug) id
    FROM public.landing_pages
    ORDER BY user_id, slug, updated_at DESC
);

-- Add unique constraint unique_user_slug
ALTER TABLE public.landing_pages
ADD CONSTRAINT unique_user_slug UNIQUE (user_id, slug);
