const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== CREATING campaign_analyses TABLE ===");
    
    const sql = `
    CREATE TABLE IF NOT EXISTS public.campaign_analyses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
      campaign_id TEXT NOT NULL,
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      metrics JSONB NOT NULL,
      analysis_text TEXT NOT NULL,
      recommendations JSONB NOT NULL
    );

    -- Enable RLS
    ALTER TABLE public.campaign_analyses ENABLE ROW LEVEL SECURITY;

    -- Drop existing policies if any
    DROP POLICY IF EXISTS select_campaign_analyses ON public.campaign_analyses;
    DROP POLICY IF EXISTS insert_campaign_analyses ON public.campaign_analyses;
    DROP POLICY IF EXISTS delete_campaign_analyses ON public.campaign_analyses;

    -- Create select policy
    CREATE POLICY select_campaign_analyses ON public.campaign_analyses
      FOR SELECT TO authenticated USING (auth.uid() = user_id);

    -- Create insert policy
    CREATE POLICY insert_campaign_analyses ON public.campaign_analyses
      FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

    -- Create delete policy
    CREATE POLICY delete_campaign_analyses ON public.campaign_analyses
      FOR DELETE TO authenticated USING (auth.uid() = user_id);
    `;

    const { data, error } = await supabaseAdmin.rpc('run_sql', {
        sql_query: sql
    });

    if (error) {
        console.error("SQL Execution Error:", error);
    } else {
        console.log("SQL Table and Policies Created successfully!");
        console.log("Result:", data);
    }
}

run().catch(console.error);
