-- Add WhatsApp API onboarding columns to profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS whatsapp_access_token TEXT,
ADD COLUMN IF NOT EXISTS whatsapp_waba_id TEXT,
ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id TEXT,
ADD COLUMN IF NOT EXISTS whatsapp_phone_number TEXT,
ADD COLUMN IF NOT EXISTS whatsapp_connected_at TIMESTAMP WITH TIME ZONE;
