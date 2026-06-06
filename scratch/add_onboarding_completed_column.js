const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRole)

async function run() {
    console.log("Running SQL migration to add 'onboarding_completed' to profiles...")
    const { data, error } = await supabaseAdmin.rpc('exec_sql', {
        query: "ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;"
    })

    if (error) {
        console.error("Migration failed:", error)
        process.exit(1)
    } else {
        console.log("Migration succeeded! Column 'onboarding_completed' added to profiles table.", data)
        process.exit(0)
    }
}

run()
