-- Fix RLS policies on properties table to support super admin and agency impersonation
DROP POLICY IF EXISTS "Users and staff can view properties" ON public.properties;
CREATE POLICY "Users and staff can view properties" ON public.properties
FOR SELECT USING (
  auth.uid() = user_id OR 
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() 
    AND (agency_id = public.properties.user_id OR parent_id = public.properties.user_id OR role = 'super_admin')
  ) OR
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = public.properties.user_id 
    AND (agency_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "Users and staff can insert properties" ON public.properties;
CREATE POLICY "Users and staff can insert properties" ON public.properties
FOR INSERT WITH CHECK (
  auth.uid() = user_id OR 
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() 
    AND (agency_id = public.properties.user_id OR parent_id = public.properties.user_id OR role = 'super_admin')
  ) OR
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = public.properties.user_id 
    AND (agency_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "Users and staff can update properties" ON public.properties;
CREATE POLICY "Users and staff can update properties" ON public.properties
FOR UPDATE USING (
  auth.uid() = user_id OR 
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() 
    AND (agency_id = public.properties.user_id OR parent_id = public.properties.user_id OR role = 'super_admin')
  ) OR
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = public.properties.user_id 
    AND (agency_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "Users and staff can delete properties" ON public.properties;
CREATE POLICY "Users and staff can delete properties" ON public.properties
FOR DELETE USING (
  auth.uid() = user_id OR 
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() 
    AND (agency_id = public.properties.user_id OR parent_id = public.properties.user_id OR role = 'super_admin')
  ) OR
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = public.properties.user_id 
    AND (agency_id = auth.uid())
  )
);


-- Fix RLS policies on assets table to support super admin and agency impersonation
DROP POLICY IF EXISTS "Users and staff can view assets" ON public.assets;
CREATE POLICY "Users and staff can view assets" ON public.assets
FOR SELECT USING (
  auth.uid() = user_id OR 
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() 
    AND (agency_id = public.assets.user_id OR parent_id = public.assets.user_id OR role = 'super_admin')
  ) OR
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = public.assets.user_id 
    AND (agency_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "Users and staff can insert assets" ON public.assets;
CREATE POLICY "Users and staff can insert assets" ON public.assets
FOR INSERT WITH CHECK (
  auth.uid() = user_id OR 
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() 
    AND (agency_id = public.assets.user_id OR parent_id = public.assets.user_id OR role = 'super_admin')
  ) OR
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = public.assets.user_id 
    AND (agency_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "Users and staff can update assets" ON public.assets;
CREATE POLICY "Users and staff can update assets" ON public.assets
FOR UPDATE USING (
  auth.uid() = user_id OR 
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() 
    AND (agency_id = public.assets.user_id OR parent_id = public.assets.user_id OR role = 'super_admin')
  ) OR
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = public.assets.user_id 
    AND (agency_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "Users and staff can delete assets" ON public.assets;
CREATE POLICY "Users and staff can delete assets" ON public.assets
FOR DELETE USING (
  auth.uid() = user_id OR 
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() 
    AND (agency_id = public.assets.user_id OR parent_id = public.assets.user_id OR role = 'super_admin')
  ) OR
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = public.assets.user_id 
    AND (agency_id = auth.uid())
  )
);
