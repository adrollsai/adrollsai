import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const HOMCOM_USER_ID = '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2'

async function inspectBuyerAudience() {
  console.log('=== 1. CHECK DISTINCT CSV AUDIENCES FOR HOMCOM ===')
  const { data: audiences } = await supabase
    .from('leads')
    .select('csv_audience')
    .eq('user_id', HOMCOM_USER_ID)
    .not('csv_audience', 'is', null)

  const distinctAudiences = Array.from(new Set(audiences?.map(a => a.csv_audience).filter(Boolean)))
  console.log('Distinct csv_audience values in HOMCOM leads:', distinctAudiences)

  // Also check all leads where csv_audience or custom_fields or source matches "buyer"
  const { data: buyerLeads, count: buyerCount } = await supabase
    .from('leads')
    .select('id, name, phone, email, csv_audience, created_at', { count: 'exact' })
    .eq('user_id', HOMCOM_USER_ID)
    .or('csv_audience.ilike.%buyer%,csv_audience.ilike.%list%')

  console.log(`Matching "buyer" / "list" leads count: ${buyerCount}`)
  console.log('Sample matching leads:', buyerLeads?.slice(0, 5))

  // Also check if any audiences table exists
  const { data: savedAudiences } = await supabase
    .from('audiences')
    .select('*')
    .eq('user_id', HOMCOM_USER_ID)
  console.log('Saved audiences in audiences table:', savedAudiences)

  // Also check total leads for HOMCOM
  const { count: totalHomcomLeads } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', HOMCOM_USER_ID)
  console.log(`Total leads in HOMCOM: ${totalHomcomLeads}`)
}

inspectBuyerAudience().then(() => process.exit(0)).catch(console.error)
