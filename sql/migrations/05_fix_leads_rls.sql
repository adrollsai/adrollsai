-- Fix RLS for leads table to allow staff members to view, insert, and update leads assigned to them or their agency
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- 1. DROP existing policies if any to prevent conflicts
DROP POLICY IF EXISTS "Users can view their own leads" ON leads;
DROP POLICY IF EXISTS "Users and staff can view leads" ON leads;

DROP POLICY IF EXISTS "Users can insert their own leads" ON leads;
DROP POLICY IF EXISTS "Users and staff can insert leads" ON leads;

DROP POLICY IF EXISTS "Users can update their own leads" ON leads;
DROP POLICY IF EXISTS "Users and staff can update leads" ON leads;

DROP POLICY IF EXISTS "Users can delete their own leads" ON leads;
DROP POLICY IF EXISTS "Users and staff can delete leads" ON leads;

-- 2. CREATE inclusive SELECT policy
CREATE POLICY "Users and staff can view leads" ON leads
FOR SELECT USING (
  auth.uid() = user_id OR 
  auth.uid() = assigned_to OR
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND (agency_id = leads.user_id OR parent_id = leads.user_id)
  )
);

-- 3. CREATE inclusive INSERT policy
CREATE POLICY "Users and staff can insert leads" ON leads
FOR INSERT WITH CHECK (
  auth.uid() = user_id OR 
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND (agency_id = leads.user_id OR parent_id = leads.user_id)
  )
);

-- 4. CREATE inclusive UPDATE policy
CREATE POLICY "Users and staff can update leads" ON leads
FOR UPDATE USING (
  auth.uid() = user_id OR 
  auth.uid() = assigned_to OR
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND (agency_id = leads.user_id OR parent_id = leads.user_id)
  )
);

-- 5. CREATE inclusive DELETE policy (restrict agent deletion)
CREATE POLICY "Users and staff can delete leads" ON leads
FOR DELETE USING (
  auth.uid() = user_id OR 
  (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND (agency_id = leads.user_id OR parent_id = leads.user_id)
    )
    AND NOT EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role = 'agent'
    )
  )
);
