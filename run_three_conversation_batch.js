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

async function runThreeConversationBatch() {
  const userId = 'd838c956-1761-4bce-9d91-32f3abecc222';
  const campaignId = '702a2914-544f-40a0-a14f-3ae28ed6f6be';

  const authId = 'MA_HOSGFZ86';
  const authToken = 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU';
  const callerId = '+917965853341';

  console.log('========================================================');
  console.log('[BATCH CALLER] Resuming 3-Conversation Campaign Test');
  console.log('Conversation 1 ALREADY RECORDED: Raja (+919891529911, 26s)');
  console.log('Remaining Conversations needed: 2');
  console.log('========================================================\n');

  // Candidate leads list
  const candidateLeads = [
    { name: 'Manoj', phone: '+918968107623', id: '6c47addf-2413-4345-9a4b-d0c394c397f6' },
    { name: 'Gurjeet', phone: '+919878008394', id: '52147bb9-0fe1-4419-8799-d62f1e56300b' },
    { name: 'Sohan Lal Bansal', phone: '+919878323405', id: '11743824-98a2-4dac-8323-ad586949e89a' },
    { name: 'Harpreet Singh', phone: '+918146370377', id: '0819cb16-d799-426d-8f79-f5ac34a03735' },
    { name: 'Raj Rana', phone: '+919814810551', id: '2b974765-2429-48fb-8c8e-1694fc2769ea' },
    { name: 'Gurmeet Bakshi', phone: '+919815893938', id: '9899f57d-1fb8-4356-a00c-90e28d1e5827' },
    { name: 'Suneel Kumar', phone: '+919812436996', id: '6b4d61d8-56cc-4ef6-80bf-d68512f9757d' }
  ];

  let completedConversations = 1; // Raja counted
  const targetConversations = 3;
  const conversationResults = [
    {
      lead: 'Raja',
      phone: '+919891529911',
      duration: '26s',
      status: 'completed',
      summary: 'Main The Khushi Ram Realtors se baat kar rahi hoon. Actually aapne social media par hamara Aerocity Mohali commercial property ka ad dekha tha, toh usi ke regarding follow-up call tha. Kya aap currently Mohali mein commercial property ya investment ke options dekh rahe hain?'
    }
  ];

  for (let i = 0; i < candidateLeads.length; i++) {
    if (completedConversations >= targetConversations) {
      console.log(`\n🎉 Target of ${targetConversations} connected conversations reached! Stopping campaign.`);
      break;
    }

    const lead = candidateLeads[i];
    console.log(`\n--------------------------------------------------------`);
    console.log(`[DIALING] Lead: ${lead.name} (${lead.phone})`);
    console.log(`[PROGRESS] Completed Conversations: ${completedConversations}/${targetConversations}`);
    console.log(`--------------------------------------------------------`);

    await supabase
      .from('leads')
      .update({
        voice_campaign_id: campaignId,
        voice_call_status: 'calling',
        last_called_at: new Date().toISOString()
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
      console.log(`[VOBIZ RESPONSE] Status: ${res.status}`, data);
    } catch (dErr) {
      console.error(`[DIAL ERROR] Failed to call ${lead.name}:`, dErr.message);
      continue;
    }

    // Monitor call progress
    console.log(`[MONITORING] Waiting for call to connect and conclude...`);
    let callEnded = false;
    let finalStatus = 'calling';

    const startTime = Date.now();
    while (!callEnded && (Date.now() - startTime) < 90000) {
      await sleep(4000);
      const { data: currentLead } = await supabase
        .from('leads')
        .select('voice_call_status, voice_call_summary, pipeline_stage')
        .eq('id', lead.id)
        .single();

      finalStatus = currentLead?.voice_call_status || finalStatus;

      if (['completed', 'no_answer', 'failed', 'busy', 'rejected'].includes(finalStatus)) {
        callEnded = true;
        console.log(`[CALL ENDED] Status: ${finalStatus}`);
        break;
      }
      process.stdout.write(`.`);
    }
    console.log('');

    if (finalStatus === 'completed') {
      completedConversations++;
      console.log(`🎉 SUCCESS: Connected conversation #${completedConversations} completed with ${lead.name}!`);

      await sleep(3000);
      const { data: history } = await supabase
        .from('lead_history')
        .select('description')
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false })
        .limit(1);

      conversationResults.push({
        lead: lead.name,
        phone: lead.phone,
        status: 'completed',
        history: history?.[0]?.description
      });
    } else {
      console.log(`ℹ️ Call with ${lead.name} did not connect (status: ${finalStatus}). Moving to next lead...`);
    }

    if (completedConversations < targetConversations) {
      console.log(`Waiting 6 seconds before dialing next lead...`);
      await sleep(6000);
    }
  }

  // Ensure campaign is set to draft
  await supabase
    .from('voice_campaigns')
    .update({ status: 'draft' })
    .eq('id', campaignId);

  console.log('\n========================================================');
  console.log(`[BATCH COMPLETED] Campaign stopped. Total conversations: ${completedConversations}/${targetConversations}`);
  console.log('Results summary:');
  console.log(JSON.stringify(conversationResults, null, 2));
  console.log('========================================================');
}

runThreeConversationBatch();
