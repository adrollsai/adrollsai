-- Create call_logs table for Android & Web Call Tracking
CREATE TABLE IF NOT EXISTS call_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    phone_number TEXT NOT NULL,
    call_type TEXT NOT NULL DEFAULT 'OUTGOING', -- OUTGOING, INCOMING, MISSED, REJECTED
    duration INTEGER NOT NULL DEFAULT 0, -- duration in seconds
    status TEXT NOT NULL DEFAULT 'CONNECTED', -- CONNECTED, NOT_CONNECTED, MISSED, DNP, BUSY, REJECTED
    recording_url TEXT,
    notes TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookup by lead, user, phone number, and date range
CREATE INDEX IF NOT EXISTS idx_call_logs_user_id ON call_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_lead_id ON call_logs(lead_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_phone_number ON call_logs(phone_number);
CREATE INDEX IF NOT EXISTS idx_call_logs_created_at ON call_logs(created_at DESC);

-- Enable RLS
ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view call logs in their org or own logs" ON call_logs
    FOR SELECT USING (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM profiles p1
            JOIN profiles p2 ON p1.agency_id = p2.agency_id OR p1.id = p2.agency_id
            WHERE p1.id = auth.uid() AND p2.id = call_logs.user_id
        )
    );

CREATE POLICY "Users can insert their own call logs" ON call_logs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own call logs" ON call_logs
    FOR UPDATE USING (auth.uid() = user_id);
