import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const HOMCOM_USER_ID = '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2'
const ADMIN_EMAIL = 'ihomcomrealtors@gmail.com'
const HEADER_IMAGE_URL = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/user_assets/9bbf6e51-283e-48d1-bbb4-8dc546cc74b2/kie_gen_1789882406376_h3h4kp.png'

const PAYMENT_PLAN_TEXT = `🏢 *THE MARQ — SECTOR 82, GMADA AEROCITY*

📍 *Location:* PR-7 Airport Road, Sector 82, Block-B, GMADA Aerocity, Mohali

━━━━━━━━━━━━━━━
💰 *RESIDENTIAL PAYMENT PLANS*
━━━━━━━━━━━━━━━

🏠 *3 BHK — 2,525 Sq. Ft.*
💵 ₹12,000/Sq. Ft. + GST
🏗️ *Tower:* 1 & 3

📋 *Payment Plan — CLP*
• 10% — Booking Amount within 30 days
• 10% — After 2 months
• 10% — After every 6 months
• 10% — On Offer of Possession

🏠 *4 BHK — 2,850 Sq. Ft.*
💵 ₹12,000/Sq. Ft. + GST
🏗️ *Tower:* 1 & 3

📋 *Payment Plan — 40:60*
• 40% — Booking Amount within 30 days
• 60% — On Offer of Possession

🏠 *4+1 BHK — 3,150 Sq. Ft.*
💵 ₹12,200/Sq. Ft. + GST
🏗️ *Tower:* 4

📋 *Payment Plan — 40:60*
• 40% — Booking Amount within 30 days
• 60% — On Offer of Possession

🏠 *5+1 BHK — 5,050 Sq. Ft.*
💵 ₹14,900/Sq. Ft. — *All Inclusive*
🏗️ *Tower:* 4

📋 *Payment Plan — 20:20:60*
• 20% — Booking Amount within 30 days
• 20% — After 18 months
• 60% — On Offer of Possession
✅ *No PLC Charges*

━━━━━━━━━━━━━━━
🏪 *COMMERCIAL SCO PAYMENT PLAN*
━━━━━━━━━━━━━━━

📐 *Size:* 17'6" × 81"

💰 *Basement + Ground Floor:* ₹7.14 Cr
💰 *First Floor:* ₹4.10 Cr
💰 *Second Floor:* ₹3.15 Cr

📋 *Payment Plan 1 — Basement + Ground Floor*
• 50% — Initial Payment
• 50% — As per payment schedule

📋 *Payment Plan 2 — First & Second Floor*
• 50% — Initial Payment
• 50% — As per payment schedule
🎯 *1% Assured Return for 3 Years*

━━━━━━━━━━━━━━━
⚠️ *ADDITIONAL CHARGES*
• Other charges applicable as per norms
• PLC & FPC charges extra where applicable
• 5+1 BHK: *No PLC Charges*

📞 *For More Details / Booking:*
*HOMCOM REALTORS*
📱 9779278117`

async function createHomcomFlow() {
  console.log(`Configuring flow for HOMCOM REALTORS (${HOMCOM_USER_ID})...`)

  // Check if a flow for marq already exists
  const { data: existingFlows } = await supabase
    .from('automations')
    .select('id, title, description')
    .eq('user_id', HOMCOM_USER_ID)

  const existingMarq = existingFlows?.find(f => 
    f.title?.toLowerCase().includes('marq') || f.description?.includes('marq')
  )

  const xyNodes = [
    {
      id: 'node_trigger',
      type: 'triggerNode',
      position: { x: 50, y: 150 },
      data: {
        title: 'The Marq — WhatsApp Broadcast',
        subtitle: 'Starting Step • Outbound Broadcast',
        triggerType: 'whatsapp_broadcast',
        templateName: 'marq',
        headerMediaUrl: HEADER_IMAGE_URL,
        buttons: [
          { id: 'view_payment_plan', title: 'View Payment Plan' }
        ],
        description: 'Fires when prospect clicks "View Payment Plan" on The Marq template message'
      }
    },
    {
      id: 'node_reply',
      type: 'whatsappMessageNode',
      position: { x: 440, y: 120 },
      data: {
        title: 'Send Full Payment Plan',
        message: PAYMENT_PLAN_TEXT
      }
    },
    {
      id: 'node_crm_stage',
      type: 'crmStageNode',
      position: { x: 840, y: 60 },
      data: {
        title: 'Move Lead to Interested',
        stage: 'Interested',
        assignAgent: 'Inderjeet Kaur',
        note: 'Prospect requested View Payment Plan for The Marq'
      }
    },
    {
      id: 'node_email',
      type: 'emailNode',
      position: { x: 840, y: 300 },
      data: {
        title: 'Email Alert to Admin',
        recipient: ADMIN_EMAIL,
        customEmail: ADMIN_EMAIL,
        customRecipient: ADMIN_EMAIL,
        templateName: 'marq',
        subject: '🔥 HOT LEAD: {{lead_name}} requested Payment Plan for The Marq!',
        body: `A prospect just clicked "View Payment Plan" on The Marq campaign.\n\nTemplate: marq\nLead Name: {{lead_name}}\nPhone: {{lead_phone}}\nDate: {{current_date}}\n\nCRM Link: {{crm_link}}`
      }
    }
  ]

  const xyEdges = [
    {
      id: 'edge_trigger_to_reply',
      source: 'node_trigger',
      sourceHandle: 'btn_view_payment_plan',
      target: 'node_reply',
      targetHandle: 'input',
      animated: true,
      style: { stroke: '#6366F1', strokeWidth: 3 }
    },
    {
      id: 'edge_reply_to_crm',
      source: 'node_reply',
      sourceHandle: 'output',
      target: 'node_crm_stage',
      targetHandle: 'input',
      animated: true,
      style: { stroke: '#10B981', strokeWidth: 2.5 }
    },
    {
      id: 'edge_reply_to_email',
      source: 'node_reply',
      sourceHandle: 'output',
      target: 'node_email',
      targetHandle: 'input',
      animated: true,
      style: { stroke: '#06B6D4', strokeWidth: 2.5 }
    }
  ]

  const flowData = {
    name: 'The Marq — Sector 82',
    isActive: true,
    templateName: 'marq',
    trigger: {
      type: 'whatsapp_broadcast',
      templateName: 'marq',
      config: {
        trigger_on: 'button_click',
        button_text: 'View Payment Plan',
        templateName: 'marq',
        customEmail: ADMIN_EMAIL
      }
    },
    nodes: xyNodes,
    edges: xyEdges,
    xyNodes: xyNodes,
    xyEdges: xyEdges,
    settings: {
      templateName: 'marq'
    }
  }

  if (existingMarq) {
    console.log(`Updating existing flow ${existingMarq.id}...`)
    const { error } = await supabase
      .from('automations')
      .update({
        title: 'Flow: The Marq — Sector 82',
        is_active: true,
        icon_name: 'Workflow',
        description: JSON.stringify(flowData),
        stats: JSON.stringify({ runs: 0, completed: 0, lastTriggeredAt: null })
      })
      .eq('id', existingMarq.id)

    if (error) throw error
    console.log(`✅ Successfully updated flow: ${existingMarq.id}`)
  } else {
    console.log('Inserting new flow record...')
    const { data: newRecord, error } = await supabase
      .from('automations')
      .insert({
        user_id: HOMCOM_USER_ID,
        title: 'Flow: The Marq — Sector 82',
        is_active: true,
        icon_name: 'Workflow',
        description: JSON.stringify(flowData),
        stats: JSON.stringify({ runs: 0, completed: 0, lastTriggeredAt: null })
      })
      .select()
      .single()

    if (error) throw error
    console.log(`✅ Successfully created flow with ID: ${newRecord.id}`)
  }
}

createHomcomFlow().then(() => process.exit(0)).catch(err => {
  console.error('Error creating flow:', err)
  process.exit(1)
})
