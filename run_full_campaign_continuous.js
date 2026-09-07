const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to fetch and upload recording to Supabase storage
async function syncVobizRecording(leadId, callUuid, authId, authToken) {
  try {
    const listRes = await fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/Recording/?call_uuid=${callUuid}`, {
      headers: {
        'X-Auth-ID': authId,
        'X-Auth-Token': authToken
      }
    });
    if (!listRes.ok) return null;
    const listData = await listRes.json();
    const recObj = listData.objects && listData.objects[0];
    if (!recObj || !recObj.recording_url) return null;

    const audioRes = await fetch(recObj.recording_url, {
      headers: {
        'X-Auth-ID': authId,
        'X-Auth-Token': authToken
      }
    });
    if (!audioRes.ok) return null;
    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

    const fileName = `${leadId}/vobiz_${Date.now()}.mp3`;
    const { error: upErr } = await supabase.storage
      .from('lead-voice-recordings')
      .upload(fileName, audioBuffer, {
        contentType: 'audio/mpeg',
        upsert: true
      });
    if (upErr) return null;

    const { data: pubData } = supabase.storage
      .from('lead-voice-recordings')
      .getPublicUrl(fileName);

    const publicUrl = pubData.publicUrl;

    await supabase.from('leads').update({
      voice_recording_url: publicUrl
    }).eq('id', leadId);

    // Also update history CALL_JSON
    const { data: latestHist } = await supabase.from('lead_history')
      .select('id, description')
      .eq('lead_id', leadId)
      .ilike('description', '%CALL_JSON%')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestHist) {
      try {
        const parsed = JSON.parse(latestHist.description.replace('🎙️ CALL_JSON:', '').trim());
        parsed.recording_url = publicUrl;
        await supabase.from('lead_history').update({
          description: '🎙️ CALL_JSON:' + JSON.stringify(parsed)
        }).eq('id', latestHist.id);
      } catch (e) {}
    }

    return publicUrl;
  } catch (err) {
    console.warn(`[SYNC REC] Error for lead ${leadId}:`, err.message);
    return null;
  }
}

async function runContinuousCampaign() {
  const campaignId = '702a2914-544f-40a0-a14f-3ae28ed6f6be';
  const authId = 'MA_HOSGFZ86';
  const authToken = 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU';
  const callerId = '+917965853341';

  // Mark campaign as running
  await supabase
    .from('voice_campaigns')
    .update({ status: 'running' })
    .eq('id', campaignId);

  const { data: campaign } = await supabase
    .from('voice_campaigns')
    .select('*')
    .eq('id', campaignId)
    .single();

  const userId = campaign.user_id;
  const filter = campaign.audience_filter || {};

  console.log('========================================================');
  console.log('[CONTINUOUS CAMPAIGN RUNNER] Started');
  console.log('Campaign:', campaign.name, `(${campaignId})`);
  console.log('Caller ID:', callerId);
  console.log('Audience:', filter.meta_campaigns);
  console.log('========================================================\n');

  // Fetch all leads for this user
  const { data: allLeads } = await supabase
    .from('leads')
    .select('id, name, phone, source, pipeline_stage, campaign_id, ad_name, csv_audience, custom_fields, voice_call_status')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  // Filter matching leads
  const matchingLeads = (allLeads || []).filter(lead => {
    let match = false;
    for (const targetMeta of filter.meta_campaigns || []) {
      const tId = targetMeta.includes('|') ? targetMeta.split('|')[0].trim() : targetMeta.trim();
      const tName = targetMeta.includes('|') ? targetMeta.split('|')[1].trim() : targetMeta.trim();
      if (lead.campaign_id && (lead.campaign_id === tId || lead.campaign_id === targetMeta)) match = true;
      if (lead.ad_name && (lead.ad_name.toLowerCase().includes(tName.toLowerCase()) || tName.toLowerCase().includes(lead.ad_name.toLowerCase()))) match = true;
      if (lead.custom_fields) {
        const cfStr = typeof lead.custom_fields === 'string' ? lead.custom_fields : JSON.stringify(lead.custom_fields);
        if (cfStr.includes(tId) || (tName && cfStr.toLowerCase().includes(tName.toLowerCase()))) match = true;
      }
    }
    return match;
  });

  // Deduplicate by 10-digit phone
  const phoneMap = new Map();
  for (const l of matchingLeads) {
    if (!l.phone) continue;
    const cleanPhone = l.phone.replace(/\D/g, '').slice(-10);
    if (!cleanPhone || cleanPhone.length < 10) continue;
    if (!phoneMap.has(cleanPhone)) {
      phoneMap.set(cleanPhone, l);
    }
  }

  // Filter only leads that have not yet been successfully completed
  const pendingLeads = Array.from(phoneMap.values()).filter(l => {
    return !l.voice_call_status || l.voice_call_status === 'not_called' || l.voice_call_status === 'calling';
  });

  console.log(`[QUEUE] Found ${pendingLeads.length} uncalled leads to dial out of ${phoneMap.size} total campaign leads.\n`);

  let processedCount = 0;
  let answeredCount = 0;
  let completedConversationsCount = 0;

  for (let i = 0; i < pendingLeads.length; i++) {
    // Check if campaign was paused or stopped by user
    const { data: currentCamp } = await supabase
      .from('voice_campaigns')
      .select('status')
      .eq('id', campaignId)
      .single();

    if (currentCamp?.status === 'paused' || currentCamp?.status === 'draft') {
      console.log(`[CAMPAIGN PAUSED] User changed campaign status to "${currentCamp.status}". Halting runner gracefully.`);
      break;
    }

    const lead = pendingLeads[i];
    console.log(`--------------------------------------------------------`);
    console.log(`[PROGRESS ${i + 1}/${pendingLeads.length}] Calling: ${lead.name} (${lead.phone})`);
    console.log(`--------------------------------------------------------`);

    // Mark as calling in Supabase
    await supabase
      .from('leads')
      .update({
        voice_campaign_id: campaignId,
        voice_call_status: 'calling',
        voice_recording_url: null
      })
      .eq('id', lead.id);

    const answerUrl = `https://gemini-voice-bridge-805895515412.us-central1.run.app/vobiz-xml?leadId=${lead.id}&profileId=${userId}&campaignId=${campaignId}`;
    const hangupUrl = `https://gemini-voice-bridge-805895515412.us-central1.run.app/vobiz-status?leadId=${lead.id}`;

    const dialPayload = {
      from: callerId,
      to: lead.phone,
      answer_url: answerUrl,
      answer_method: 'POST',
      hangup_url: hangupUrl,
      hangup_method: 'POST'
    };

    let callUuid = null;
    try {
      const vobizUrl = `https://api.vobiz.ai/api/v1/Account/${authId}/Call/`;
      const res = await fetch(vobizUrl, {
        method: 'POST',
        headers: {
          'X-Auth-ID': authId,
          'X-Auth-Token': authToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(dialPayload)
      });
      const data = await res.json();
      callUuid = data.request_uuid || data.call_uuid || data.api_id;
      console.log(`[VOBIZ RESPONSE] Status: ${res.status}, Call UUID: ${callUuid}`);
    } catch (dErr) {
      console.error(`[DIAL ERROR] Failed to call ${lead.name}:`, dErr.message);
      continue;
    }

    // Monitor call progress
    process.stdout.write(`[CALL RINGING] `);
    let callEnded = false;
    let finalStatus = 'calling';
    let recTriggered = false;
    const startTime = Date.now();

    while (!callEnded && (Date.now() - startTime) < 95000) {
      await sleep(3500);
      const { data: currentLead } = await supabase
        .from('leads')
        .select('voice_call_status')
        .eq('id', lead.id)
        .single();

      finalStatus = currentLead?.voice_call_status || finalStatus;

      // Trigger recording via REST API as soon as call is active
      if (!recTriggered && callUuid) {
        recTriggered = true;
        fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/Call/${callUuid}/Record/`, {
          method: 'POST',
          headers: {
            'X-Auth-ID': authId,
            'X-Auth-Token': authToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            file_format: 'mp3',
            time_limit: 600,
            callback_url: hangupUrl,
            callback_method: 'POST'
          })
        }).catch(() => {});
      }

      if (['completed', 'no_answer', 'failed', 'busy', 'rejected'].includes(finalStatus)) {
        callEnded = true;
        console.log(`\n[CALL ENDED] Status: ${finalStatus}`);
        break;
      }
      process.stdout.write(`.`);
    }

    // Wait 5 seconds for background processing
    await sleep(5000);

    // Sync audio recording from Vobiz to Supabase storage if completed
    let publicAudioUrl = null;
    if (callUuid && finalStatus === 'completed') {
      publicAudioUrl = await syncVobizRecording(lead.id, callUuid, authId, authToken);
    }

    const { data: finalLead } = await supabase
      .from('leads')
      .select('name, phone, voice_call_status, voice_call_summary, voice_recording_url, voice_call_transcript, pipeline_stage')
      .eq('id', lead.id)
      .single();

    const transcript = finalLead?.voice_call_transcript || [];
    const isAnswered = Array.isArray(transcript) && transcript.length > 0;
    const isCompletedConv = Array.isArray(transcript) && transcript.length >= 2;

    processedCount++;
    if (isAnswered) answeredCount++;
    if (isCompletedConv) completedConversationsCount++;

    console.log(`[CALL SUMMARY] Lead: ${lead.name} | Status: ${finalStatus} | Turns: ${transcript.length} | Recording: ${publicAudioUrl ? 'YES' : (finalLead?.voice_recording_url ? 'YES' : 'NONE')}`);
    if (finalLead?.voice_call_summary) {
      console.log(`[AI SUMMARY] ${finalLead.voice_call_summary}`);
    }
    if (transcript.length > 0) {
      console.log(`[TRANSCRIPT PREVIEW] Last Turn: "${transcript[transcript.length - 1]?.message}"`);
    }
    console.log(`[RUNNER TOTALS] Processed: ${processedCount}/${pendingLeads.length} | Answered: ${answeredCount} | Conversations: ${completedConversationsCount}\n`);

    // Polite delay between outbound calls
    await sleep(4000);
  }

  // If all pending leads processed, mark campaign completed
  const { data: remainingLeads } = await supabase
    .from('leads')
    .select('id')
    .eq('user_id', userId)
    .eq('voice_campaign_id', campaignId)
    .or('voice_call_status.is.null,voice_call_status.eq.not_called')
    .limit(1);

  if (!remainingLeads || remainingLeads.length === 0) {
    await supabase
      .from('voice_campaigns')
      .update({ status: 'completed' })
      .eq('id', campaignId);
    console.log('\n🎉 ALL LEADS IN CAMPAIGN PROCESSED! Campaign marked completed.');
  }

  console.log('Continuous campaign runner finished.');
}

runContinuousCampaign().catch(console.error);
