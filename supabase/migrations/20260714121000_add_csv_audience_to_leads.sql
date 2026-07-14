-- Add csv_audience to leads table
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS csv_audience TEXT;
