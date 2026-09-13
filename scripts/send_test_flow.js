const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function sendTestFlow() {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, whatsapp_personal_number, whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_access_token, facebook_token')
    .eq('email', 'rchopra489@gmail.com')
    .single();

  const recipient = (profile.whatsapp_personal_number || '').replace(/\D/g, '');
  const token = profile.whatsapp_access_token || profile.facebook_token;
  const phoneId = profile.whatsapp_phone_number_id;
  const flowId = '854097601031672';

  // Fetch recent assets
  const { data: assets } = await supabaseAdmin
    .from('assets')
    .select('id, url, caption, type, created_at')
    .eq('user_id', profile.id)
    .order('created_at', { ascending: false })
    .limit(5);

  const creativeItems = (assets || []).map((a, i) => ({
    id: a.url,
    title: (a.caption || `Creative #${i + 1}`).substring(0, 30).trim(),
    description: `${(a.type || 'Image').toUpperCase()} • ${a.url.slice(-20)}`
  }));

  console.log(`Sending Flow to ${recipient} using phoneId ${phoneId} with ${creativeItems.length} items...`);

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient,
    type: 'interactive',
    interactive: {
      type: 'flow',
      header: {
        type: 'text',
        text: '🎨 Choose Campaign Creatives'
      },
      body: {
        text: 'Select one or more creatives from your library to attach to your campaign.'
      },
      footer: {
        text: 'Nobogent AI'
      },
      action: {
        name: 'flow',
        parameters: {
          flow_message_version: '3',
          flow_token: `campaign_picker_${Date.now()}`,
          flow_id: flowId,
          flow_cta: `Select Creatives (${creativeItems.length})`,
          flow_action: 'navigate',
          flow_action_payload: {
            screen: 'CHOOSE_CREATIVES',
            data: {
              creatives: creativeItems
            }
          }
        }
      }
    }
  };

  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  console.log('Send Flow Result:', JSON.stringify(data, null, 2));
}

sendTestFlow().catch(console.error);
