const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://dvygrupphzjitzbrtlve.supabase.co'
const supabaseServiceRole = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2eWdydXBwaHpqaXR6YnJ0bHZlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTM4OTkxNiwiZXhwIjoyMDgwOTY1OTE2fQ.WfJTY1EDtVAIePBlf97wVAiZlxNKUWydcXP-LcEiCDA'

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRole)

async function run() {
    console.log("Running SQL migration to add 'business_info' to profiles...")
    const { data, error } = await supabaseAdmin.rpc('run_sql', {
        sql_query: "ALTER TABLE profiles ADD COLUMN IF NOT EXISTS business_info TEXT;"
    })

    if (error) {
        console.error("Migration failed:", error)
    } else {
        console.log("Migration succeeded! Column 'business_info' added to profiles table.", data)
    }
}

run()
