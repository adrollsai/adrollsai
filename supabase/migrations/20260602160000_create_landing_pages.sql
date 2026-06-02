-- Create qualification_forms table
CREATE TABLE IF NOT EXISTS public.qualification_forms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    fields JSONB NOT NULL DEFAULT '[]'::jsonb,
    custom_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS for qualification_forms
ALTER TABLE public.qualification_forms ENABLE ROW LEVEL SECURITY;

-- Create landing_pages table
CREATE TABLE IF NOT EXISTS public.landing_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    product_name TEXT NOT NULL,
    html_content TEXT NOT NULL,
    form_id UUID REFERENCES public.qualification_forms(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_user_slug UNIQUE (user_id, slug)
);

-- Enable RLS for landing_pages
ALTER TABLE public.landing_pages ENABLE ROW LEVEL SECURITY;

-- DROP policies if they already exist to avoid errors
DROP POLICY IF EXISTS "Allow users to read their own forms" ON public.qualification_forms;
DROP POLICY IF EXISTS "Allow users to insert their own forms" ON public.qualification_forms;
DROP POLICY IF EXISTS "Allow users to update their own forms" ON public.qualification_forms;
DROP POLICY IF EXISTS "Allow users to delete their own forms" ON public.qualification_forms;

DROP POLICY IF EXISTS "Allow public read of landing pages" ON public.landing_pages;
DROP POLICY IF EXISTS "Allow users to insert their own pages" ON public.landing_pages;
DROP POLICY IF EXISTS "Allow users to update their own pages" ON public.landing_pages;
DROP POLICY IF EXISTS "Allow users to delete their own pages" ON public.landing_pages;

-- Create policies for qualification_forms
CREATE POLICY "Allow users to read their own forms" ON public.qualification_forms
    FOR SELECT USING (
        auth.uid() = user_id OR 
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND (role = 'super_admin' OR agency_id = qualification_forms.user_id)
        )
    );

CREATE POLICY "Allow users to insert their own forms" ON public.qualification_forms
    FOR INSERT WITH CHECK (
        auth.uid() = user_id OR 
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND (role = 'super_admin' OR agency_id = qualification_forms.user_id)
        )
    );

CREATE POLICY "Allow users to update their own forms" ON public.qualification_forms
    FOR UPDATE USING (
        auth.uid() = user_id OR 
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND (role = 'super_admin' OR agency_id = qualification_forms.user_id)
        )
    );

CREATE POLICY "Allow users to delete their own forms" ON public.qualification_forms
    FOR DELETE USING (
        auth.uid() = user_id OR 
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND (role = 'super_admin' OR agency_id = qualification_forms.user_id)
        )
    );

-- Create policies for landing_pages
CREATE POLICY "Allow public read of landing pages" ON public.landing_pages
    FOR SELECT USING (true); -- Public needs to see the landing page!

CREATE POLICY "Allow users to insert their own pages" ON public.landing_pages
    FOR INSERT WITH CHECK (
        auth.uid() = user_id OR 
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND (role = 'super_admin' OR agency_id = landing_pages.user_id)
        )
    );

CREATE POLICY "Allow users to update their own pages" ON public.landing_pages
    FOR UPDATE USING (
        auth.uid() = user_id OR 
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND (role = 'super_admin' OR agency_id = landing_pages.user_id)
        )
    );

CREATE POLICY "Allow users to delete their own pages" ON public.landing_pages
    FOR DELETE USING (
        auth.uid() = user_id OR 
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND (role = 'super_admin' OR agency_id = landing_pages.user_id)
        )
    );
