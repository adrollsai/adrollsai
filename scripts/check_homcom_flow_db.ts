import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const HOMCOM_USER_ID = '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2'

async function checkFlow() {
  const { data: flows } = await supabase
    .from('automations')
    .select('*')
    .eq('user_id', HOMCOM_USER_ID)

  console.log('Automations count for Homcom:', flows?.length)
  for (const f of flows || []) {
    console.log(`\nFlow ID: ${f.id} | Title: ${f.title} | Active: ${f.is_active}`)
    const desc = JSON.parse(f.description || '{}')
    console.log('Nodes count:', desc.xyNodes?.length || desc.nodes?.length)
    console.log('Edges count:', desc.xyEdges?.length || desc.edges?.length)
    console.log('Nodes:', (desc.xyNodes || desc.nodes)?.map((n: any) => ({ id: n.id, type: n.type, title: n.data?.title })))
    console.log('Edges:', desc.xyEdges || desc.edges)
  }
}

checkFlow().then(() => process.exit(0)).catch(console.error)
