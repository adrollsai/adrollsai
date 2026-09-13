const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function uploadFlowJson() {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_access_token, facebook_token')
    .eq('email', 'rchopra489@gmail.com')
    .single();

  const token = profile.whatsapp_access_token || profile.facebook_token;
  const flowId = '854097601031672';

  const flowDefinition = {
    version: '7.3',
    screens: [
      {
        id: 'CHOOSE_CREATIVES',
        title: 'Select Creatives',
        terminal: true,
        data: {
          creatives: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                description: { type: 'string' }
              }
            },
            __example__: [
              {
                id: 'img_1',
                title: 'Delhi NCR Luxury Flyer',
                description: '1080x1080 Promo'
              },
              {
                id: 'img_2',
                title: 'Modern Architecture Video',
                description: '9:16 Reel'
              }
            ]
          }
        },
        layout: {
          type: 'SingleColumnLayout',
          children: [
            {
              type: 'TextHeading',
              text: 'Choose Creatives'
            },
            {
              type: 'TextSubheading',
              text: 'Select the creatives you want to attach to your campaign:'
            },
            {
              type: 'CheckboxGroup',
              name: 'selected_creatives',
              label: 'Select one or more',
              'data-source': '${data.creatives}',
              required: true
            },
            {
              type: 'Footer',
              label: 'Attach to Campaign',
              'on-click-action': {
                name: 'complete',
                payload: {
                  selected_creatives: '${form.selected_creatives}'
                }
              }
            }
          ]
        }
      }
    ]
  };

  const formData = new FormData();
  formData.append('name', 'flow.json');
  formData.append('asset_type', 'FLOW_JSON');
  const blob = new Blob([JSON.stringify(flowDefinition, null, 2)], { type: 'application/json' });
  formData.append('file', blob, 'flow.json');

  const res = await fetch(`https://graph.facebook.com/v20.0/${flowId}/assets`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });

  const data = await res.json();
  console.log('Upload Asset Result:', JSON.stringify(data, null, 2));
}

uploadFlowJson().catch(console.error);
