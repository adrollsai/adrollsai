const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function callLeads() {
  const userId = '68b55a31-a16d-454d-a20f-11adabf590b0'; // Bioque Estates International
  const voiceCampaignId = 'bee2bf56-cd5b-4646-8120-a3498f4acf95'; // Shahrukhz Residences

  console.log('[DISPATCH] Fetching Bioque profile credentials...');
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  const bi = typeof profile.business_info === 'string' ? JSON.parse(profile.business_info) : (profile.business_info || {});
  const authId = bi.voice_vobiz_auth_id || profile.voice_vobiz_auth_id || process.env.VOBIZ_AUTH_ID;
  const authToken = bi.voice_vobiz_auth_token || profile.voice_vobiz_auth_token || process.env.VOBIZ_AUTH_TOKEN;
  const fromPhone = bi.claimed_vobiz_number || profile.voice_vobiz_number || profile.voice_twilio_number || '+917965480539';

  console.log(`[DISPATCH] Calling credentials: From=${fromPhone}, AuthID=${authId}`);

  // Fetch the 3 leads
  const leadIds = [
    '4cb3db89-032c-48d0-a058-9b0fe36b2bee', // Reyansh karthik
    '60646b7b-c083-4861-b3ac-d9524aca8df8', // Ravi S
    '4e71f882-d3ec-49cd-9334-37b89d187a17'  // Saber / Saniya
  ];

  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('*')
    .in('id', leadIds);

  console.log(`[DISPATCH] Found ${leads.length} leads to call and keep in Fresh section.\n`);

  for (const lead of leads) {
    console.log(`----------------------------------------------------------------`);
    console.log(`📞 Initiating call for ${lead.name} (${lead.phone})...`);

    // Ensure lead is in Fresh section (New Lead)
    await supabaseAdmin
      .from('leads')
      .update({
        pipeline_stage: 'New Lead',
        status: 'New Lead',
        voice_call_status: 'calling',
        voice_call_scheduled_at: new Date().toISOString()
      })
      .eq('id', lead.id);

    // Pre-warm voice session
    const bridgeUrl = 'https://gemini-voice-bridge-805895515412.us-central1.run.app';
    try {
      await fetch(`${bridgeUrl}/prewarm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: lead.id,
          profileId: userId,
          campaignId: voiceCampaignId,
          voiceName: 'Kore'
        })
      });
    } catch (e) {
      console.warn('Prewarm notice:', e.message);
    }

    // Format destination number
    let cleanPhone = lead.phone.replace(/\D/g, '');
    if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;
    if (!cleanPhone.startsWith('+')) cleanPhone = '+' + cleanPhone;

    const appUrl = 'https://app.nobogent.com';
    const answerUrl = `${appUrl}/api/voice/vobiz/xml?leadId=${lead.id}&profileId=${userId}&campaignId=${voiceCampaignId}&voiceName=Kore`;
    const hangupUrl = `${appUrl}/api/voice/vobiz/status-callback?leadId=${lead.id}`;

    const requestPayload = {
      from: fromPhone,
      to: cleanPhone,
      answer_url: answerUrl,
      answer_method: 'POST',
      hangup_url: hangupUrl,
      hangup_method: 'POST'
    };

    try {
      const vobizEndpoint = `https://api.vobiz.ai/api/v1/Account/${authId}/Call/`;
      const res = await fetch(vobizEndpoint, {
        method: 'POST',
        headers: {
          'X-Auth-ID': authId,
          'X-Auth-Token': authToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestPayload)
      });

      const rawRes = await res.text();
      console.log(`[VOBIZ RESPONSE] HTTP ${res.status}:`, rawRes);

      let parsed = null;
      try { parsed = JSON.parse(rawRes); } catch (e) {}

      if (res.ok) {
        console.log(`✅ Successfully dispatched call to ${lead.name} (${cleanPhone})! Request UUID:`, parsed.request_uuid || parsed.call_uuid);
      } else {
        console.error(`❌ Failed to call ${lead.name}:`, rawRes);
      }
    } catch (dialErr) {
      console.error(`❌ Dial error for ${lead.name}:`, dialErr.message);
    }

    // Pause 3 seconds between calls to avoid carrier rate limits
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log(`\n🎉 All leads processed! All remain firmly categorized in Fresh section.`);
}

callLeads().catch(console.error);
