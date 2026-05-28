-- Fix RLS policies on leads table to support super admin and agency impersonation
DROP POLICY IF EXISTS "Users and staff can view leads" ON public.leads;
CREATE POLICY "Users and staff can view leads" ON public.leads
FOR SELECT USING (
  auth.uid() = user_id OR 
  auth.uid() = assigned_to OR
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() 
    AND (agency_id = public.leads.user_id OR parent_id = public.leads.user_id OR role = 'super_admin')
  ) OR
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = public.leads.user_id 
    AND (agency_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "Users and staff can insert leads" ON public.leads;
CREATE POLICY "Users and staff can insert leads" ON public.leads
FOR INSERT WITH CHECK (
  auth.uid() = user_id OR 
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() 
    AND (agency_id = public.leads.user_id OR parent_id = public.leads.user_id OR role = 'super_admin')
  ) OR
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = public.leads.user_id 
    AND (agency_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "Users and staff can update leads" ON public.leads;
CREATE POLICY "Users and staff can update leads" ON public.leads
FOR UPDATE USING (
  auth.uid() = user_id OR 
  auth.uid() = assigned_to OR
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() 
    AND (agency_id = public.leads.user_id OR parent_id = public.leads.user_id OR role = 'super_admin')
  ) OR
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = public.leads.user_id 
    AND (agency_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "Users and staff can delete leads" ON public.leads;
CREATE POLICY "Users and staff can delete leads" ON public.leads
FOR DELETE USING (
  auth.uid() = user_id OR 
  (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() 
      AND (agency_id = public.leads.user_id OR parent_id = public.leads.user_id OR role = 'super_admin')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() 
      AND role = 'agent'
    )
  ) OR
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = public.leads.user_id 
    AND (agency_id = auth.uid())
  )
);
