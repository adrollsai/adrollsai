-- Add character_description column to the profiles table to cache visual analysis of character avatars
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS character_description TEXT;
