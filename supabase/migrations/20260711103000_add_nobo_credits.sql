-- Add credits column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS credits INTEGER DEFAULT 0;

-- Seed baseline credits for existing profiles based on subscription plan
UPDATE public.profiles
SET credits = 20000
WHERE (LOWER(subscription_plan) = 'growth' OR LOWER(subscription_plan) = 'standard') AND (credits IS NULL OR credits = 0);

UPDATE public.profiles
SET credits = 30000
WHERE LOWER(subscription_plan) = 'pro' AND (credits IS NULL OR credits = 0);

UPDATE public.profiles
SET credits = 200
WHERE (subscription_plan IS NULL OR LOWER(subscription_plan) = 'free' OR LOWER(subscription_plan) = 'early bird') AND (credits IS NULL OR credits = 0);

-- Create credit_transactions ledger table
CREATE TABLE IF NOT EXISTS public.credit_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    amount INTEGER NOT NULL, -- negative for deductions, positive for topups/allocations
    category VARCHAR(50) NOT NULL, -- 'calling', 'whatsapp', 'ai_generation', 'campaign_launch', 'topup', 'subscription'
    description TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on credit_transactions
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own transactions" ON public.credit_transactions;
CREATE POLICY "Users can view their own transactions" 
ON public.credit_transactions FOR SELECT 
TO authenticated 
USING (auth.uid() = user_id);

-- Setup Realtime Publication for credit_transactions
ALTER TABLE public.credit_transactions REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'profiles'
    ) THEN
        -- Make sure profiles is in realtime too
        ALTER TABLE public.profiles REPLICA IDENTITY FULL;
    END IF;
END $$;

-- Add table to publication if not already present
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' AND tablename = 'credit_transactions'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.credit_transactions;
        END IF;
    END IF;
END $$;
