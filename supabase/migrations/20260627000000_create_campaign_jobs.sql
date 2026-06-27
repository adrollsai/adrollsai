-- Create campaign_jobs table for background progress tracking
CREATE TABLE IF NOT EXISTS campaign_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    target_user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    campaign_id TEXT,
    message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable row level security
ALTER TABLE campaign_jobs ENABLE ROW LEVEL SECURITY;

-- Create policy to allow users to read their own campaign tracking status
CREATE POLICY "Users can read own campaign jobs" ON campaign_jobs 
    FOR SELECT TO authenticated 
    USING (auth.uid() = user_id OR auth.uid() = target_user_id);
