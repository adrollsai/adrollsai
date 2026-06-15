-- Create reference_creatives table
CREATE TABLE IF NOT EXISTS public.reference_creatives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category TEXT NOT NULL CHECK (category IN ('premium', 'edm', 'high_converting')),
    url TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.reference_creatives ENABLE ROW LEVEL SECURITY;

-- Drop policies if they exist
DROP POLICY IF EXISTS "Allow public read of reference_creatives" ON public.reference_creatives;
DROP POLICY IF EXISTS "Allow super_admins to manage reference_creatives" ON public.reference_creatives;

-- Allow public read of reference_creatives
CREATE POLICY "Allow public read of reference_creatives" ON public.reference_creatives
    FOR SELECT USING (true);

-- Allow super_admin users to insert/update/delete reference_creatives
CREATE POLICY "Allow super_admins to manage reference_creatives" ON public.reference_creatives
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'super_admin'
        )
    );
