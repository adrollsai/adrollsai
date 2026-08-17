-- Add image_descriptions to properties table
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS image_descriptions JSONB DEFAULT '[]'::jsonb;

-- Create an image_analysis_cache table for caching image analysis by image URL hash / URL
CREATE TABLE IF NOT EXISTS public.image_analysis_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    image_url TEXT UNIQUE NOT NULL,
    image_url_hash TEXT,
    description TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.image_analysis_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all authenticated users to read image cache" ON public.image_analysis_cache;
CREATE POLICY "Allow all authenticated users to read image cache" ON public.image_analysis_cache FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all authenticated users to insert image cache" ON public.image_analysis_cache;
CREATE POLICY "Allow all authenticated users to insert image cache" ON public.image_analysis_cache FOR ALL TO authenticated USING (true) WITH CHECK (true);
