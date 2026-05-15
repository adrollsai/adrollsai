-- Add currency column to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'INR';

-- Verify column exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='currency') THEN
        ALTER TABLE profiles ADD COLUMN currency TEXT DEFAULT 'INR';
    END IF;
END $$;
