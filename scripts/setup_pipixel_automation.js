const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function setupPipixelAutomation() {
  const pipixelId = 'c7bede84-d7ea-4b02-bbbb-017d24a37914';
  const flowTitle = 'Flow: Immigration Free Trial Campaign';

  const flowPayload = {
    name: 'Flow: Immigration Free Trial Campaign',
    isActive: true,
    templateName: 'immigration_trial',
    trigger: {
      type: 'triggerNode',
      templateName: 'immigration_trial',
      config: {
        trigger_on: 'button_click',
        button_text: 'Claim Free Trial!',
        templateName: 'immigration_trial',
        customEmail: 'pawan@pipixel.io'
      }
    },
    xyNodes: [
      {
        id: 'node_trigger',
        type: 'triggerNode',
        position: { x: 50, y: 150 },
        data: {
          title: 'WhatsApp Broadcast: Immigration Free Trial',
          triggerType: 'whatsapp_broadcast',
          templateName: 'immigration_trial',
          buttons: [
            { id: 'btn_trial', title: 'Claim Free Trial!' },
            { id: 'btn_trial_plain', title: 'Claim Free Trial' },
            { id: 'btn_trial_lower', title: 'trial' }
          ],
          description: 'Fires when a recipient taps "Claim Free Trial!" on the immigration_trial template'
        }
      },
      {
        id: 'node_reply',
        type: 'whatsappMessageNode',
        position: { x: 450, y: 80 },
        data: {
          title: 'Send Confirmation Reply',
          message: 'Hi {{lead_name}}! 🚀 Thank you for claiming your Free Trial!\n\nOur team at PiPixel has been notified and we will reach out to you shortly to set everything up for your immigration business.\n\nIf you have any immediate questions, feel free to reply right here! 🙏'
        }
      },
      {
        id: 'node_email',
        type: 'emailNode',
        position: { x: 450, y: 320 },
        data: {
          title: 'Notify pawan@pipixel.io',
          recipient: 'pawan@pipixel.io',
          customEmail: 'pawan@pipixel.io',
          customRecipient: 'pawan@pipixel.io',
          templateName: 'immigration_trial',
          subject: '🔥 HOT LEAD: {{lead_name}} ({{lead_phone}}) clicked Claim Free Trial!',
          body: 'A prospect just clicked "Claim Free Trial!" on the Immigration Free Trial WhatsApp broadcast.\n\nTemplate: immigration_trial\nLead Name: {{lead_name}}\nPhone: {{lead_phone}}\nDate: {{current_date}}\n\nCRM Link: {{crm_link}}'
        }
      },
      {
        id: 'node_crm_stage',
        type: 'crmStageNode',
        position: { x: 820, y: 200 },
        data: {
          title: 'Move Lead to Interested',
          stage: 'Interested',
          note: 'Clicked "Claim Free Trial!" on immigration_trial WhatsApp broadcast'
        }
      }
    ],
    xyEdges: [
      {
        id: 'edge_trig_reply',
        source: 'node_trigger',
        target: 'node_reply',
        sourceHandle: 'btn_btn_trial',
        animated: true,
        style: { stroke: '#6366F1', strokeWidth: 2.5 }
      },
      {
        id: 'edge_reply_email',
        source: 'node_reply',
        target: 'node_email',
        animated: true,
        style: { stroke: '#10B981', strokeWidth: 2.5 }
      },
      {
        id: 'edge_email_crm',
        source: 'node_email',
        target: 'node_crm_stage',
        animated: true,
        style: { stroke: '#F59E0B', strokeWidth: 2.5 }
      }
    ]
  };

  // Check if automation already exists
  const { data: existing } = await supabaseAdmin
    .from('automations')
    .select('id')
    .eq('user_id', pipixelId)
    .eq('title', flowTitle);

  let flowId;
  if (existing && existing.length > 0) {
    flowId = existing[0].id;
    await supabaseAdmin
      .from('automations')
      .update({
        is_active: true,
        description: JSON.stringify(flowPayload),
        updated_at: new Date().toISOString()
      })
      .eq('id', flowId);
    console.log(`✅ Updated existing PiPixel automation flow ID: ${flowId}`);
  } else {
    const { data: newAuto, error: insErr } = await supabaseAdmin
      .from('automations')
      .insert({
        user_id: pipixelId,
        title: flowTitle,
        is_active: true,
        description: JSON.stringify(flowPayload),
        created_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (insErr) {
      console.error('Error creating automation:', insErr);
      return;
    }
    flowId = newAuto.id;
    console.log(`✅ Created PiPixel automation flow ID: ${flowId}`);
  }

  // Also ensure whatsapp_flows has header_media_url mapped so worker can reference it
  const imageUrl = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/library/c7bede84-d7ea-4b02-bbbb-017d24a37914/1790064783995-ChatGPTImageSep222026014241PM.jpg';
  
  const { data: existingWf } = await supabaseAdmin
    .from('whatsapp_flows')
    .select('id')
    .eq('user_id', pipixelId)
    .eq('template_name', 'immigration_trial');

  if (existingWf && existingWf.length > 0) {
    await supabaseAdmin
      .from('whatsapp_flows')
      .update({
        header_media_url: imageUrl,
        is_active: true
      })
      .eq('id', existingWf[0].id);
  } else {
    await supabaseAdmin
      .from('whatsapp_flows')
      .insert({
        user_id: pipixelId,
        title: 'Immigration Free Trial',
        template_name: 'immigration_trial',
        template_body: '🚀 Immigration Business Owners - Want More Appointments?',
        header_media_url: imageUrl,
        is_active: true
      });
  }
  console.log('✅ Template header media URL mapped in whatsapp_flows');
}

setupPipixelAutomation();
