const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://dvygrupphzjitzbrtlve.supabase.co'
const supabaseServiceRole = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2eWdydXBwaHpqaXR6YnJ0bHZlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTM4OTkxNiwiZXhwIjoyMDgwOTY1OTE2fQ.WfJTY1EDtVAIePBlf97wVAiZlxNKUWydcXP-LcEiCDA'

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRole)

const targetUserId = '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2'
const cutoffDate = '2026-05-27T00:00:00+05:30' // 27/05/2026 local time

async function run() {
    console.log(`Querying leads for sub-account ${targetUserId} created before ${cutoffDate}...`)
    
    // 1. Fetch the leads to be deleted to verify
    const { data: leads, error: fetchError } = await supabaseAdmin
        .from('leads')
        .select('id, name, email, phone, created_at, pipeline_stage')
        .eq('user_id', targetUserId)
        .lt('created_at', cutoffDate)
        .order('created_at', { ascending: false })

    if (fetchError) {
        console.error("Fetch failed:", fetchError)
        return
    }

    if (!leads || leads.length === 0) {
        console.log("No leads found matching the criteria!")
        return
    }

    console.log(`Found ${leads.length} leads to delete:`)
    leads.forEach((l, index) => {
        console.log(`[${index + 1}] ID: ${l.id} | Name: ${l.name} | Created At: ${l.created_at} | Stage: ${l.pipeline_stage}`)
    })

    console.log("\nStarting deletion of these leads...")
    
    // 2. Perform deletion
    const { data: deletedLeads, error: deleteError } = await supabaseAdmin
        .from('leads')
        .delete()
        .eq('user_id', targetUserId)
        .lt('created_at', cutoffDate)
        .select('id')

    if (deleteError) {
        console.error("Deletion failed:", deleteError)
    } else {
        console.log(`Successfully deleted ${deletedLeads ? deletedLeads.length : 0} leads from the sub-account!`)
    }
}

run()
