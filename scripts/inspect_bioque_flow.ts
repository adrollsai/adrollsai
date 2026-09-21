import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function inspectBioqueFlowCols() {
  const { data: flow } = await supabase
    .from('automations')
    .select('*')
    .eq('id', 'b019e075-88d3-4929-a1b7-a3f89012f99a')
    .single()

  if (flow) {
    console.log('--- FLOW TITLE ---')
    console.log(flow.title)
    console.log('--- FLOW DESCRIPTION (PARSED) ---')
    try {
      const parsed = JSON.parse(flow.description)
      console.log(JSON.stringify(parsed, null, 2))
    } catch {
      console.log(flow.description)
    }
  }
}

inspectBioqueFlowCols().then(() => process.exit(0)).catch(console.error)
