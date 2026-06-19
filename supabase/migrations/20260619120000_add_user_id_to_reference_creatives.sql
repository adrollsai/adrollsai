-- Alter table to add user_id column referencing profiles
ALTER TABLE public.reference_creatives ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Drop old policies
DROP POLICY IF EXISTS "Allow public read of reference_creatives" ON public.reference_creatives;
DROP POLICY IF EXISTS "Allow super_admins to manage reference_creatives" ON public.reference_creatives;

-- Create new policies
CREATE POLICY "Allow users to read reference_creatives" ON public.reference_creatives
    FOR SELECT USING (
        user_id = auth.uid() OR 
        (user_id IS NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')) OR
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
    );

CREATE POLICY "Allow users to insert reference_creatives" ON public.reference_creatives
    FOR INSERT WITH CHECK (
        user_id = auth.uid() OR 
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
    );

CREATE POLICY "Allow users to update reference_creatives" ON public.reference_creatives
    FOR UPDATE USING (
        user_id = auth.uid() OR 
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
    );

CREATE POLICY "Allow users to delete reference_creatives" ON public.reference_creatives
    FOR DELETE USING (
        user_id = auth.uid() OR 
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
    );
