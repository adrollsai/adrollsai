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

async function runCampaignBatch() {
  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222';
  const campaignId = '702a2914-544f-40a0-a14f-3ae28ed6f6be';

  const authId = 'MA_HOSGFZ86';
  const authToken = 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU';
  const callerId = '+917965853341';

  console.log('========================================================');
  console.log('[CAMPAIGN RUNNER] Calling Next High-Quality Batch from Commerical_1Cr');
  console.log('Campaign ID:', campaignId);
  console.log('Caller ID:', callerId);
  console.log('Goal: Keep dialing until an engaged, conversational prospect is found');
  console.log('========================================================\n');

  // Candidate fresh leads with clean names and verified Indian mobile numbers
  const candidates = [
    { name: 'Bhushan Benjwal', phone: '+919888838317', id: '91bb4de2-8b61-454f-81cb-8b976bc7496f' },
    { name: 'Manwinder Singh', phone: '+919501023016', id: '609f6bb7-ed5f-457b-963e-bb0315eda57c' },
    { name: 'Reena Uppal', phone: '+919855793400', id: '505c9bd2-b213-4494-a598-17c85fcbac1d' },
    { name: 'Babal Bawa', phone: '+919968737854', id: '4878e695-4ed5-4f49-a252-1ea98ae1977d' },
    { name: 'Tarun', phone: '+919250908628', id: 'a8e2b34d-1eb7-4c6e-908f-bcd9dbd4075b' },
    { name: 'Chirag Malhotra', phone: '+917347221668', id: 'baddb804-ac23-4ed6-a6f2-fc5058f262a9' }
  ];

  let fullConversationsCount = 0;
  const targetConversations = 1; // Stop when we get an engaged conversation
  const results = [];

  for (let i = 0; i < candidates.length; i++) {
    if (fullConversationsCount >= targetConversations) {
      console.log(`\n🎉 Goal achieved! Found engaged prospect having a full conversation. Stopping batch.`);
      break;
    }

    const lead = candidates[i];
    console.log(`\n--------------------------------------------------------`);
    console.log(`[DIALING ${i + 1}/${candidates.length}] Lead: ${lead.name} (${lead.phone})`);
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
      console.error(`[DIAL ERROR] Failed to trigger call to ${lead.name}:`, dErr.message);
      continue;
    }

    // Monitor call progress
    console.log(`[MONITORING] Call ringing... Waiting for prospect to answer or call to end...`);
    let callEnded = false;
    let finalStatus = 'calling';
    const startTime = Date.now();

    let recordingTriggered = false;
    while (!callEnded && (Date.now() - startTime) < 95000) {
      await sleep(3500);
      const { data: currentLead } = await supabase
        .from('leads')
        .select('voice_call_status, voice_call_summary, voice_recording_url, voice_call_transcript, pipeline_stage')
        .eq('id', lead.id)
        .single();

      finalStatus = currentLead?.voice_call_status || finalStatus;

      // Trigger recording via REST API as soon as call is active
      if (!recordingTriggered && callUuid) {
        recordingTriggered = true;
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
        }).then(r => r.json()).then(d => {
          if (d.api_id || d.url) console.log(`[VOBIZ RECORD] Initiated:`, d);
        }).catch(() => {});
      }

      if (['completed', 'no_answer', 'failed', 'busy', 'rejected'].includes(finalStatus)) {
        callEnded = true;
        console.log(`\n[CALL STATUS] Final telephony status: ${finalStatus}`);
        break;
      }
      process.stdout.write(`.`);
    }

    // Wait 6 seconds for recording sync to finish
    console.log('\n[SYNC] Finalizing recording and transcript in Supabase...');
    await sleep(6000);

    const { data: finalLead } = await supabase
      .from('leads')
      .select('id, name, phone, voice_call_status, voice_call_summary, voice_recording_url, voice_call_transcript, pipeline_stage, booked_time')
      .eq('id', lead.id)
      .single();

    const { data: hist } = await supabase
      .from('lead_history')
      .select('description, created_at')
      .eq('lead_id', lead.id)
      .ilike('description', '%CALL_JSON%')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let transcript = finalLead?.voice_call_transcript || [];
    let summary = finalLead?.voice_call_summary || '';
    let recUrl = finalLead?.voice_recording_url || '';

    if (hist?.description?.startsWith('🎙️ CALL_JSON:')) {
      try {
        const parsed = JSON.parse(hist.description.replace('🎙️ CALL_JSON:', '').trim());
        if (!transcript.length && parsed.transcript) transcript = parsed.transcript;
        if (!summary && parsed.summary) summary = parsed.summary;
        if (!recUrl && parsed.recording_url) recUrl = parsed.recording_url;
      } catch (e) {}
    }

    // Detect whether prospect was a real human vs automated voicemail
    const transcriptText = Array.isArray(transcript) ? transcript.map(m => m.message || '').join(' ').toLowerCase() : '';
    const isVoicemail = transcriptText.includes('not available') || 
                        transcriptText.includes('at the tone') || 
                        transcriptText.includes('record your message') || 
                        transcriptText.includes('switched off') ||
                        transcriptText.includes('after the beep') ||
                        transcriptText.includes('leave a message');

    const hasFullHumanConversation = !isVoicemail && Array.isArray(transcript) && transcript.length >= 2;

    const callResult = {
      lead: lead.name,
      phone: lead.phone,
      id: lead.id,
      callUuid,
      status: finalLead?.voice_call_status || finalStatus,
      pipeline_stage: finalLead?.pipeline_stage,
      isVoicemail,
      hasFullHumanConversation,
      messagesCount: Array.isArray(transcript) ? transcript.length : 0,
      recordingUrl: recUrl,
      summary,
      transcript
    };

    results.push(callResult);

    console.log('\n================ CALL OUTCOME ================');
    console.log(`Lead: ${lead.name} (${lead.phone})`);
    console.log(`Telephony Status: ${callResult.status}`);
    console.log(`Messages Exchanged: ${callResult.messagesCount}`);
    console.log(`Voicemail Machine: ${isVoicemail ? 'YES' : 'NO'}`);
    console.log(`Audio Recording: ${callResult.recordingUrl || 'None'}`);
    if (callResult.summary) console.log(`AI Summary: ${callResult.summary}`);
    if (callResult.transcript?.length) {
      console.log('Transcript:');
      callResult.transcript.forEach(m => console.log(`  [${m.role === 'agent' ? 'AI' : lead.name}]: ${m.message}`));
    }
    console.log('==============================================\n');

    if (hasFullHumanConversation) {
      fullConversationsCount++;
      console.log(`🌟 GENUINE HUMAN CONVERSATION CAPTURED with ${lead.name}!`);
    }

    if (fullConversationsCount < targetConversations) {
      console.log('Waiting 5 seconds before dialing next prospect...');
      await sleep(5000);
    }
  }

  // Ensure campaign remains in draft
  await supabase
    .from('voice_campaigns')
    .update({ status: 'draft' })
    .eq('id', campaignId);

  console.log('\n========================================================');
  console.log('[BATCH SUMMARY]');
  console.log(`Total dialed: ${results.length}`);
  console.log(`Full conversations: ${fullConversationsCount}`);
  console.log('========================================================\n');
}

runCampaignBatch().catch(console.error);
