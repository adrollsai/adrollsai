const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("Testing RPC 'run_sql' to add avatar columns...");
    const sql = `
        ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
        ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_description TEXT;
        ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_audio_url TEXT;
    `;
    const { data, error } = await supabaseAdmin.rpc('run_sql', { sql_query: sql });
    
    if (error) {
        console.error("RPC Error:", error);
    } else {
        console.log("Success! RPC Result:", data);
    }
}

run().catch(console.error);
