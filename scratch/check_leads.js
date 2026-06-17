const { createClient } = require('@supabase/supabase-js')

const url = "https://dvygrupphzjitzbrtlve.supabase.co"
const serviceKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2eWdydXBwaHpqaXR6YnJ0bHZlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTM4OTkxNiwiZXhwIjoyMDgwOTY1OTE2fQ.WfJTY1EDtVAIePBlf97wVAiZlxNKUWydcXP-LcEiCDA"

const supabase = createClient(url, serviceKey)

async function test() {
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, user_id, ad_name')
  
  if (error) {
    console.error("Error fetching leads:", error)
    return
  }

  console.log(`Total Leads found in DB: ${leads.length}`)
  const uniqueUsers = new Set()
  const camps = new Set()
  leads.forEach(l => {
    uniqueUsers.add(l.user_id)
    if (l.ad_name) camps.add(l.ad_name)
  })

  console.log("Unique User IDs in Leads table:", Array.from(uniqueUsers))
  console.log("Campaigns / Ad Names in Leads table:", Array.from(camps))
}

test()
