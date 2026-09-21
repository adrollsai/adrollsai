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
    const listRes = await fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/Recording/?call_uuid=${callUuid}&limit=10`, {
      headers: {
        'X-Auth-ID': authId,
        'X-Auth-Token': authToken
      }
    });
    if (!listRes.ok) return null;
    const listData = await listRes.json();
    const objects = listData.objects || [];
    if (objects.length === 0) return null;

    let bestBuffer = null;
    for (const recObj of objects) {
      const recUrl = recObj?.recording_url || recObj?.url || recObj?.mp3_url;
      if (!recUrl) continue;
      try {
        const audioRes = await fetch(recUrl, {
          headers: {
            'X-Auth-ID': authId,
            'X-Auth-Token': authToken
          }
        });
        if (audioRes.ok) {
          const buf = Buffer.from(await audioRes.arrayBuffer());
          if (buf.byteLength > 5000 && (!bestBuffer || buf.byteLength > bestBuffer.byteLength)) {
            bestBuffer = buf;
          }
        }
      } catch (fErr) {}
    }

    if (!bestBuffer) return null;

    const fileName = `${leadId}/vobiz_${Date.now()}.mp3`;
    const { error: upErr } = await supabase.storage
      .from('lead-voice-recordings')
      .upload(fileName, bestBuffer, {
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

async function runFarmhouseCampaign() {
  const campaignId = '7bacf4e8-d8fb-4c70-bf24-aa5394dc9d40';
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

  console.log('========================================================');
  console.log('[FARMHOUSE CAMPAIGN RUNNER] Started');
  console.log('Campaign:', campaign.name, `(${campaignId})`);
  console.log('Caller ID:', callerId);
  console.log('Target: 10 Successful Connected Conversations');
  console.log('========================================================\n');

  // Fetch all assigned leads for this campaign
  const { data: allLeads } = await supabase
    .from('leads')
    .select('id, name, phone, source, pipeline_stage, campaign_id, ad_name, voice_call_status')
    .eq('user_id', userId)
    .eq('voice_campaign_id', campaignId)
    .order('created_at', { ascending: false });

  // Deduplicate by 10-digit phone
  const phoneMap = new Map();
  for (const l of (allLeads || [])) {
    if (!l.phone) continue;
    const cleanPhone = l.phone.replace(/\D/g, '').slice(-10);
    if (!cleanPhone || cleanPhone.length < 10) continue;
    if (cleanPhone === '8288835235') continue; // skip test phone
    if (!phoneMap.has(cleanPhone)) {
      phoneMap.set(cleanPhone, l);
    }
  }

  const pendingLeads = Array.from(phoneMap.values()).filter(l => {
    return !l.voice_call_status || l.voice_call_status === 'not_called' || l.voice_call_status === 'calling';
  });

  console.log(`[QUEUE] Found ${pendingLeads.length} uncalled Farmhouse leads ready to dial.\n`);

  let processedCount = 0;
  let answeredCount = 0;
  let completedConversationsCount = 0;

  for (let i = 0; i < pendingLeads.length; i++) {
    const { data: currentCamp } = await supabase
      .from('voice_campaigns')
      .select('status')
      .eq('id', campaignId)
      .single();

    if (currentCamp?.status === 'paused' || currentCamp?.status === 'draft') {
      console.log(`[CAMPAIGN PAUSED] User changed campaign status to "${currentCamp.status}". Halting runner.`);
      break;
    }

    const lead = pendingLeads[i];
    console.log(`--------------------------------------------------------`);
    console.log(`[PROGRESS ${i + 1}/${pendingLeads.length}] Calling Farmhouse Lead: ${lead.name} (${lead.phone})`);
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
    const startTime = Date.now();

    let recTriggered = false;
    while (!callEnded && (Date.now() - startTime) < 95000) {
      await sleep(3500);
      const { data: currentLead } = await supabase
        .from('leads')
        .select('voice_call_status')
        .eq('id', lead.id)
        .single();

      finalStatus = currentLead?.voice_call_status || finalStatus;

      // Trigger recording via REST API as soon as call is initiated
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

    // Wait 5 seconds for background audio processing
    await sleep(5000);

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
    if (isCompletedConv) {
      completedConversationsCount++;
      console.log(`\n🎉 [CONVERSATION #${completedConversationsCount}] Connected conversation completed with ${lead.name}!`);
    }

    console.log(`[CALL SUMMARY] Lead: ${lead.name} | Status: ${finalStatus} | Turns: ${transcript.length} | Recording: ${publicAudioUrl ? 'YES' : (finalLead?.voice_recording_url ? 'YES' : 'NONE')}`);
    if (finalLead?.voice_call_summary) {
      console.log(`[AI SUMMARY] ${finalLead.voice_call_summary}`);
    }
    if (transcript.length > 0) {
      console.log(`[TRANSCRIPT PREVIEW] Last Turn: "${transcript[transcript.length - 1]?.message}"`);
    }

    // Automatic Admin Notification for Interested / Booked leads
    if (finalStatus === 'completed' && finalLead) {
      const summaryText = (finalLead.voice_call_summary || '').toLowerCase();
      const isNotInterested = summaryText.includes('not interested') || summaryText.includes('disinterest') || summaryText.includes('no interest') || summaryText.includes('accidental');
      const isInterested = !isNotInterested && (summaryText.includes('interested') || summaryText.includes('inquired') || summaryText.includes('looking for') || summaryText.includes('rates') || summaryText.includes('plot sizes') || summaryText.includes('location'));
      const isBooked = summaryText.includes('booked') || summaryText.includes('scheduled a visit') || summaryText.includes('site visit confirmed');

      if (isBooked || isInterested) {
        console.log(`[ADMIN NOTIFY] 🔔 Triggering multi-channel admin alert for ${lead.name} (${isBooked ? 'Appointment Booked' : 'High-Interest Lead'})...`);
        try {
          await fetch('https://app.nobogent.com/api/voice/post-call-notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              leadId: lead.id,
              profileId: userId,
              isQualified: true,
              leadPriority: isBooked ? 'HOT' : 'HOT',
              bookingTime: isBooked ? new Date(Date.now() + 48 * 3600 * 1000).toISOString() : null,
              summary: finalLead.voice_call_summary || '',
              skipProspectWhatsApp: true
            })
          });
          console.log(`[ADMIN NOTIFY] ✅ Admin notified successfully for ${lead.name}`);
        } catch (nErr) {
          console.warn('[ADMIN NOTIFY ERROR]', nErr.message);
        }
      }
    }

    console.log(`[RUNNER TOTALS] Processed: ${processedCount}/${pendingLeads.length} | Answered: ${answeredCount} | Connected Conversations: ${completedConversationsCount}\n`);

    // Polite delay between outbound calls
    await sleep(4000);
  }

  console.log('Farmhouse campaign batch completed.');
}

runFarmhouseCampaign().catch(console.error);
