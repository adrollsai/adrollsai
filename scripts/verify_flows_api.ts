import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const HOMCOM_USER_ID = '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2'

async function checkFlowsApiLogic() {
  const { data: rows, error } = await supabase
    .from('automations')
    .select('*')
    .eq('user_id', HOMCOM_USER_ID)
    .like('title', 'Flow:%')

  if (error) throw error

  console.log('Found flows count:', rows?.length)
  for (const row of (rows || [])) {
    const flowData = JSON.parse(row.description || '{}')
    const cleanName = row.title.replace(/^Flow:\s*/, '')
    const flowOutput = {
      id: row.id,
      name: flowData.name || cleanName,
      triggerType: flowData.xyNodes?.[0]?.data?.triggerType,
      triggerTitle: flowData.xyNodes?.[0]?.data?.title,
      nodesCount: flowData.xyNodes?.length,
      nodeTitles: flowData.xyNodes?.map((n: any) => n.data?.title),
      buttons: flowData.xyNodes?.[0]?.data?.buttons
    }
    console.log('Flow inspection:', JSON.stringify(flowOutput, null, 2))
  }
}

checkFlowsApiLogic().then(() => process.exit(0)).catch(console.error)
