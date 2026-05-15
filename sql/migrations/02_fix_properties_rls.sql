-- Fix RLS for properties table to allow staff members to add products for their agency
-- 1. Enable RLS (already enabled probably)
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing insert policy if it's too restrictive
DROP POLICY IF EXISTS "Users can insert their own properties" ON properties;

-- 3. Create a more inclusive insert policy
CREATE POLICY "Users and staff can insert properties" ON properties
FOR INSERT WITH CHECK (
  auth.uid() = user_id OR 
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND (agency_id = properties.user_id OR parent_id = properties.user_id)
  )
);

-- 4. Update Select policy as well just in case
DROP POLICY IF EXISTS "Users can view their own properties" ON properties;
CREATE POLICY "Users and staff can view properties" ON properties
FOR SELECT USING (
  auth.uid() = user_id OR 
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND (agency_id = properties.user_id OR parent_id = properties.user_id)
  )
);

-- 5. Update Update/Delete policies
DROP POLICY IF EXISTS "Users can update their own properties" ON properties;
CREATE POLICY "Users and staff can update properties" ON properties
FOR UPDATE USING (
  auth.uid() = user_id OR 
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND (agency_id = properties.user_id OR parent_id = properties.user_id)
  )
);

DROP POLICY IF EXISTS "Users can delete their own properties" ON properties;
CREATE POLICY "Users and staff can delete properties" ON properties
FOR DELETE USING (
  auth.uid() = user_id OR 
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND (agency_id = properties.user_id OR parent_id = properties.user_id)
  )
);
