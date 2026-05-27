-- Fix RLS for assets table to allow staff and parent agencies/admins to view and manage assets for their subaccounts
-- 1. Enable RLS
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing SELECT policy if it's too restrictive
DROP POLICY IF EXISTS "Users can view their own assets" ON assets;
DROP POLICY IF EXISTS "Users and staff can view assets" ON assets;

-- 3. Create a more inclusive SELECT policy
CREATE POLICY "Users and staff can view assets" ON assets
FOR SELECT USING (
  auth.uid() = user_id OR 
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND (agency_id = assets.user_id OR parent_id = assets.user_id)
  )
);

-- 4. Drop existing INSERT policy
DROP POLICY IF EXISTS "Users can insert their own assets" ON assets;
DROP POLICY IF EXISTS "Users and staff can insert assets" ON assets;

-- 5. Create a more inclusive INSERT policy
CREATE POLICY "Users and staff can insert assets" ON assets
FOR INSERT WITH CHECK (
  auth.uid() = user_id OR 
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND (agency_id = assets.user_id OR parent_id = assets.user_id)
  )
);

-- 6. Drop existing UPDATE policy
DROP POLICY IF EXISTS "Users can update their own assets" ON assets;
DROP POLICY IF EXISTS "Users and staff can update assets" ON assets;

-- 7. Create a more inclusive UPDATE policy
CREATE POLICY "Users and staff can update assets" ON assets
FOR UPDATE USING (
  auth.uid() = user_id OR 
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND (agency_id = assets.user_id OR parent_id = assets.user_id)
  )
);

-- 8. Drop existing DELETE policy
DROP POLICY IF EXISTS "Users can delete their own assets" ON assets;
DROP POLICY IF EXISTS "Users and staff can delete assets" ON assets;

-- 9. Create a more inclusive DELETE policy
CREATE POLICY "Users and staff can delete assets" ON assets
FOR DELETE USING (
  auth.uid() = user_id OR 
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND (agency_id = assets.user_id OR parent_id = assets.user_id)
  )
);
