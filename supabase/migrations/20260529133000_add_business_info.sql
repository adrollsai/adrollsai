-- Add business_info column to profiles table for dynamic LLM business context
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS business_info TEXT;
