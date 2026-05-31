const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("=== EXECUTING DATABASE MIGRATION FOR BILLING AND ADD-ONS ===");
    
    const ddl = `
        -- Add add-on quota columns
        ALTER TABLE profiles ADD COLUMN IF NOT EXISTS addon_videos INTEGER DEFAULT 0;
        ALTER TABLE profiles ADD COLUMN IF NOT EXISTS addon_images INTEGER DEFAULT 0;
        ALTER TABLE profiles ADD COLUMN IF NOT EXISTS addon_team_members INTEGER DEFAULT 0;
        ALTER TABLE profiles ADD COLUMN IF NOT EXISTS addon_campaign_launches INTEGER DEFAULT 0;
        ALTER TABLE profiles ADD COLUMN IF NOT EXISTS addon_campaign_optimizations INTEGER DEFAULT 0;
        ALTER TABLE profiles ADD COLUMN IF NOT EXISTS addon_retargeting_campaigns INTEGER DEFAULT 0;

        -- Add separate usage tracking columns as requested
        ALTER TABLE profiles ADD COLUMN IF NOT EXISTS videos_used INTEGER DEFAULT 0;
        ALTER TABLE profiles ADD COLUMN IF NOT EXISTS images_used INTEGER DEFAULT 0;
        ALTER TABLE profiles ADD COLUMN IF NOT EXISTS campaign_optimizations_used INTEGER DEFAULT 0;
        ALTER TABLE profiles ADD COLUMN IF NOT EXISTS retargeting_campaigns_used INTEGER DEFAULT 0;
        ALTER TABLE profiles ADD COLUMN IF NOT EXISTS team_members_used INTEGER DEFAULT 0;
    `;

    const { data, error } = await supabaseAdmin.rpc('run_sql', {
        sql_query: ddl
    });

    if (error) {
        console.error("Migration Error:", error);
    } else {
        console.log("Migration Successful! Result:", JSON.stringify(data, null, 2));
    }
}

run().catch(console.error);
