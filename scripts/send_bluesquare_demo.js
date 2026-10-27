const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runDemo() {
  const targetPhone = '+918288835235';
  const cleanPhone = '918288835235';
  const blueSquareProfileId = '2f62a259-f23b-48ee-a920-c436f36eaa4b';

  console.log('========================================================');
  console.log('🚀 TRIGGERING DEMO WHATSAPP MESSAGE & AI VOICE CALL');
  console.log('========================================================');

  // 1. Fetch Blue Square Infra profile
  const { data: profile, error: pErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', blueSquareProfileId)
    .single();

  if (pErr || !profile) {
    console.error('Failed to fetch Blue Square Infra profile:', pErr);
    return;
  }

  console.log(`🏢 Profile: ${profile.business_name} (${profile.email})`);
  console.log(`📱 Recipient: ${targetPhone}`);

  // 2. Fetch or create a demo Meta Lead under Blue Square Infra
  let { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('user_id', profile.id)
    .ilike('phone', `%${cleanPhone.slice(-10)}%`)
    .limit(1)
    .maybeSingle();

  const demoCustomFields = {
    is_instant_form: true,
    lead_source: 'Meta Lead Ads (Facebook)',
    campaign_name: 'Blue Square Infra - Luxury Residential Plots',
    ad_name: 'Anmol Avenue plots Mohali',
    'What type of property are you interested in?': 'Residential Plot (500 sq yd)',
    'What is your investment budget?': '₹1.5 Cr - ₹2 Cr',
    'When are you planning to make a decision?': 'Within 1-2 months',
    'Preferred Location': 'Near Mohali / Airport Road',
    property_type: 'Residential Plot',
    budget: '1.5-2 Cr',
    timeline: '1-2 months'
  };

  if (!lead) {
    console.log('Creating demo lead under Blue Square Infra...');
    const { data: newLead } = await supabase
      .from('leads')
      .insert({
        user_id: profile.id,
        name: 'Rahul Chopra',
        phone: targetPhone,
        email: 'rchopra489@gmail.com',
        source: 'Facebook Ad',
        ad_name: 'Anmol Avenue plots Mohali',
        custom_fields: demoCustomFields
      })
      .select()
      .single();
    lead = newLead;
  } else {
    // Update custom_fields with rich Instant Form Q&A so Gemini confirms them on call
    await supabase
      .from('leads')
      .update({
        custom_fields: { ...(lead.custom_fields || {}), ...demoCustomFields }
      })
      .eq('id', lead.id);
  }

  console.log(`👤 Lead ID: ${lead.id} (${lead.name})`);

  // ========================================================
  // STEP 1: SEND DEMO WHATSAPP MESSAGE (lead_welcome_options)
  // ========================================================
  console.log('\n--- [1/2] SENDING WHATSAPP 3-BUTTON WELCOME MESSAGE ---');
  const waToken = profile.whatsapp_access_token;
  const waPhoneId = profile.whatsapp_phone_number_id;

  const waPayload = {
    messaging_product: 'whatsapp',
    to: cleanPhone,
    type: 'template',
    template: {
      name: 'lead_welcome_options',
      language: { code: 'en_US' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Rahul' },
            { type: 'text', text: profile.business_name || 'Blue Square Infra' }
          ]
        }
      ]
    }
  };

  try {
    const waRes = await fetch(`https://graph.facebook.com/v20.0/${waPhoneId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${waToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(waPayload)
    });
    const waData = await waRes.json();
    if (waRes.ok && waData.messages?.[0]?.id) {
      console.log(`✅ WhatsApp message sent! WAMID: ${waData.messages[0].id}`);
      console.log(`   Template: lead_welcome_options (Buttons: View Properties | Connect with Expert | Book an appointment)`);
    } else {
      console.error('❌ WhatsApp delivery response:', waData);
    }
  } catch (waErr) {
    console.error('❌ WhatsApp send failed:', waErr.message);
  }

  // ========================================================
  // STEP 2: TRIGGER PRODUCTION AI VOICE CALL (Fenrir Voice)
  // ========================================================
  console.log('\n--- [2/2] TRIGGERING AI VOICE CALL (Fenrir / Male Voice) ---');
  const voiceName = 'Fenrir';
  const prodBridgeUrl = 'https://gemini-voice-bridge-805895515412.us-central1.run.app';

  const authId = 'SA_CU21FXWZ';
  const authToken = '2I3CYSJRQGZdukyCVKvKfUO5jpuWpUm5dXzcCu9we31x4CoV5G3zYmlffLz859eP';
  const callerId = '+917965853341'; // Active Indian Vobiz virtual number

  const answerUrl = `${prodBridgeUrl}/vobiz-xml?leadId=${lead.id}&profileId=${profile.id}&voiceName=${voiceName}`;
  const hangupUrl = `${prodBridgeUrl}/vobiz-status?leadId=${lead.id}`;

  // Pre-warm session on production container
  console.log('⚡ Pre-warming Gemini voice session on production container...');
  try {
    const pwRes = await fetch(`${prodBridgeUrl}/prewarm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leadId: lead.id,
        profileId: profile.id,
        voiceName: voiceName
      })
    });
    const pwData = await pwRes.json().catch(() => ({}));
    console.log('⚡ Pre-warm response:', pwData);
  } catch (pwErr) {
    console.warn('⚡ Pre-warm non-blocking error:', pwErr.message);
  }

  const callPayload = {
    from: callerId,
    to: targetPhone,
    answer_url: answerUrl,
    answer_method: 'POST',
    hangup_url: hangupUrl,
    hangup_method: 'POST'
  };

  console.log(`📞 Dialing ${targetPhone} from ${callerId}...`);
  console.log(`   Answer URL: ${answerUrl}`);

  const vobizUrl = `https://api.vobiz.ai/api/v1/Account/${authId}/Call/`;
  const callRes = await fetch(vobizUrl, {
    method: 'POST',
    headers: {
      'X-Auth-ID': authId,
      'X-Auth-Token': authToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(callPayload)
  });

  const callData = await callRes.json().catch(() => ({}));
  if (callRes.ok) {
    console.log(`\n🎉 Call successfully initiated! Call UUID: ${callData.request_uuid || JSON.stringify(callData)}`);
    console.log('>>> Your phone will ring in a few seconds! <<<');
  } else {
    console.error('\n❌ Call initiation failed:', callData);
  }
}

runDemo().catch(console.error);
