-- Migration: Add DNP & Call Feedback tracking columns to leads table

ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS dnp_count INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_call_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_call_status TEXT,
ADD COLUMN IF NOT EXISTS last_called_by UUID REFERENCES profiles(id);

CREATE INDEX IF NOT EXISTS idx_leads_dnp_count ON leads(dnp_count);
CREATE INDEX IF NOT EXISTS idx_leads_last_call_at ON leads(last_call_at);
