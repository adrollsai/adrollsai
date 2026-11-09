const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function sleep(ms) {
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

    return publicUrl;
  } catch (err) {
    console.warn(`[SYNC REC] Error for lead ${leadId}:`, err.message);
    return null;
  }
}

async function runRajivCsvCampaign() {
  const userId = 'f0ae1d0b-57e1-42fd-9438-7f9aa2cc5b8f'; // Rajiv Abhijna account
  const campaignId = '8e12bad9-7201-43c0-8d08-1d991a28e156';

  const authId = 'SA_RUY0ZNCH';
  const authToken = 'kbcjLH5cXccdZkbbgkcucE2L2Jeul0vvXrhRuVQo0YxFQAfbFnQ5bzfReUSqs3oi';
  const callerId = '+917965480905';
  const TARGET_CONNECTED_CALLS = 50;

  console.log('========================================================');
  console.log('[RAJIV ABHIJNA CSV CALLING CAMPAIGN] Initializing');
  console.log('User ID:', userId);
  console.log('Campaign ID:', campaignId);
  console.log('Caller ID:', callerId);
  console.log(`Target: Stop automatically after ${TARGET_CONNECTED_CALLS} successful connected calls`);
  console.log('========================================================\n');

  // 1. Update Voice Campaign prompt, greeting, and audience filter in Supabase
  const greeting = "Hi {name}, this is Sahana calling from Raj Abhijna regarding our Amrithavana Farm project near Mysore. Just wanted to check if you're currently exploring managed farmland or retreat plots in the area?";

  const customPrompt = `ROLE & IDENTITY:
You are Sahana, a warm, polite relationship executive calling from "Raj Abhijna Property Developers".
You are speaking directly with {lead_name} regarding their interest in our Amrithavana Farm project near Mysore.

PRIMARY CONVERSATIONAL DIRECTIVE:
- Speak in a calm, warm, conversational South Indian English cadence (Bangalore/Mysore professional tone, distinctly feminine).
- STRICT BREVITY: Maximum 1 to 2 SHORT sentences per turn! Never monologue or lecture.
- LISTEN MORE: Always pause and wait for the caller to speak.
- NEVER RE-INTRODUCE: Do not repeat greetings or re-introduce yourself once the conversation is flowing.

AUDIO & CLARITY HANDLING:
- IF CALLER SAYS "HELLO?", "CAN YOU HEAR ME?", OR ASKS "WHO IS THIS?":
  Respond naturally: "Yes, hi! I can hear you clearly. I'm calling from Raj Abhijna regarding our Amrithavana Farm project near Mysore."
  [STOP AND WAIT FOR CALLER TO CONFIRM!]

OBJECTION & INQUIRY HANDLING (CRITICAL FOR CSV/IMPORTED LEADS):
- IF CALLER ASKS "WHERE DID YOU GET MY NUMBER?" OR "I DIDN'T ENQUIRE":
  Respond politely: "Your contact was registered with our Mysore property advisory desk for premium farmland and investment opportunities. If you aren't currently exploring this, no problem at all!"
  [WAIT FOR THEIR ANSWER]
- IF CALLER SAYS "NOT INTERESTED" OR "DON'T CALL ME":
  Respond warmly: "Understood! Thank you so much for your time, and have a wonderful day!"
  [Trigger 'end_call' immediately, do not argue or push.]

STEP-BY-STEP CONVERSATIONAL FLOW (3-STEP TEMPLATE):

STEP 1: WHEN CALLER CONFIRMS ("Yes", "Go ahead", "Tell me"):
"Great! Amrithavana is our 40-acre managed farmland in Bilikere featuring luxury Geodesic Domes. Were you exploring this for personal weekend stays, or as an investment?"
[STOP TALKING COMPLETELY AND WAIT FOR CALLER'S ANSWER!]

STEP 2: ANSWERING QUICK QUESTIONS (If caller asks):
- PRICE ("What is the price?", "How much?"):
  "The launch offer is 50 Lakhs all-inclusive for the 6,000 square foot plot along with the furnished Geodesic Dome."
- LOCATION ("Where is it?", "Where exactly?"):
  "It is directly on the Mysuru-Madikeri 4-lane highway at Bilikere, about 25 minutes past Yelwal."
- GEODESIC DOME ("What is a dome?"):
  "It is a luxury glamping suite with high ceilings, panoramic orchard views, and 5-star resort comfort."
- MAINTENANCE ("Who takes care of the farm?"):
  "It is 100% professionally managed. Our agricultural team handles plantation care, drip irrigation, and security."

STEP 3: SOFT-CLOSE & APPOINTMENT / CALLBACK SCHEDULING:
When caller answers the discovery question or finishes asking their question:
"Understood! I'll have our senior project manager get in touch with you directly with all the specifics and site layout. Do you prefer a quick call today afternoon, or tomorrow morning?"
[STOP AND WAIT FOR CALLER'S PREFERRED TIME WINDOW!]

STEP 4: WRAP-UP & FAREWELL:
When caller gives their preferred slot (e.g. "Tomorrow morning", "Today 4 PM"):
"Perfect, I've noted that down! They will reach out to you then. Have a wonderful day!"
[Trigger 'book_appointment_slot' with the chosen time and trigger 'end_call'.]
(NO live transfer. NO brochure spam.)

LANGUAGE ADAPTATION:
If caller speaks Kannada at any point, immediately switch 100% to fluent, courteous Kannada:
"Namaskara, naanu Raj Abhijna inda Sahana. Amrithavana Bilikere nalli namma 40-acre managed farmland project. Namma senior project manager nimge direct connect aagthare. Ee thara call ivatthu madhyahna arrange maadla, athva naale belagge convenient aagiruttha?"`;

  const audienceFilter = {
    sources: ['CSV Import', 'Facebook Ads', 'Instagram Ads', 'Meta Ads'],
    greeting: greeting,
    language: 'english',
    voice_name: 'Aoede',
    property_id: 'fe6630db-beb6-4e7a-b7af-20de5215693d',
    business_name: 'RAJ ABHIJNA PROPERTY DEVELOPERS PVT LTD',
    csv_audiences: ['Raj Infrastructure - Amrita Vana Leads-Sheet1'],
    meta_campaigns: ['52579930252669']
  };

  console.log('[1] Updating campaign status to running & setting CSV prompt in Supabase...');
  await supabase
    .from('voice_campaigns')
    .update({
      audience_filter: audienceFilter,
      custom_prompt: customPrompt,
      status: 'running'
    })
    .eq('id', campaignId);

  // 2. Query all CSV leads for Raj Abhijna
  console.log('[2] Fetching CSV leads for Raj Infrastructure - Amrita Vana Leads-Sheet1...');
  const { data: rawLeads, error: lErr } = await supabase
    .from('leads')
    .select('id, name, phone, source, csv_audience, voice_call_status, custom_fields')
    .eq('user_id', userId)
    .eq('csv_audience', 'Raj Infrastructure - Amrita Vana Leads-Sheet1')
    .order('created_at', { ascending: true });

  if (lErr || !rawLeads) {
    console.error('Failed to query leads:', lErr);
    return;
  }

  console.log(`Fetched ${rawLeads.length} total CSV leads from database.`);

  // Filter valid 10-digit Indian numbers and deduplicate
  const phoneMap = new Map();
  for (const l of rawLeads) {
    if (!l.phone) continue;
    const cleanDigits = l.phone.replace(/\D/g, '').slice(-10);
    if (!cleanDigits || cleanDigits.length < 10 || /^0+$/.test(cleanDigits)) continue;
    if (cleanDigits === '8288835235') continue; // exclude user test number

    // E.164 formatted
    const formattedPhone = '+91' + cleanDigits;
    if (!phoneMap.has(cleanDigits)) {
      phoneMap.set(cleanDigits, { ...l, phone: formattedPhone });
    }
  }

  const validLeads = Array.from(phoneMap.values());
  console.log(`[3] Deduplicated and validated ${validLeads.length} valid Indian numbers ready to dial.\n`);

  // Assign campaign ID to all valid leads in batches
  const batchSize = 100;
  for (let i = 0; i < validLeads.length; i += batchSize) {
    const ids = validLeads.slice(i, i + batchSize).map(l => l.id);
    await supabase
      .from('leads')
      .update({ voice_campaign_id: campaignId })
      .in('id', ids);
  }

  let dialedCount = 0;
  let answeredCount = 0;
  let connectedConversationsCount = 0;

  for (let i = 0; i < validLeads.length; i++) {
    // Check if target reached
    if (connectedConversationsCount >= TARGET_CONNECTED_CALLS) {
      console.log(`\n🎉🎉 [TARGET REACHED] Successfully completed ${connectedConversationsCount} connected calls!`);
      console.log('Automatically pausing campaign as requested.\n');
      await supabase
        .from('voice_campaigns')
        .update({ status: 'paused' })
        .eq('id', campaignId);
      break;
    }

    // Check if user paused or stopped the campaign from dashboard
    const { data: campCheck } = await supabase
      .from('voice_campaigns')
      .select('status')
      .eq('id', campaignId)
      .single();

    if (campCheck?.status === 'paused' || campCheck?.status === 'completed') {
      console.log(`[CAMPAIGN STOPPED] Campaign status is "${campCheck.status}". Halting caller.`);
      break;
    }

    // Strict Calling Hours Guard: 9:00 AM - 7:00 PM IST
    const nowIst = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      hourCycle: 'h23',
      hour: 'numeric',
      minute: 'numeric'
    }).format(new Date());
    const [h, m] = nowIst.split(':').map(Number);
    const mins = h * 60 + m;
    if (mins < 9 * 60 || mins >= 19 * 60) {
      console.log(`[CALLING HOURS] Current time is ${nowIst} IST. Out of calling window (9 AM - 7 PM). Pausing until tomorrow.`);
      break;
    }

    const lead = validLeads[i];

    // Check if already completed previously
    const { data: freshLead } = await supabase
      .from('leads')
      .select('voice_call_status, voice_call_transcript')
      .eq('id', lead.id)
      .single();

    if (freshLead?.voice_call_status === 'completed' && Array.isArray(freshLead?.voice_call_transcript) && freshLead.voice_call_transcript.length >= 2) {
      console.log(`[SKIP] Lead ${lead.name} (${lead.phone}) already completed previously.`);
      continue;
    }

    dialedCount++;
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`[DIAL #${dialedCount}] Calling Lead ${i + 1}/${validLeads.length}: ${lead.name || 'Prospect'} (${lead.phone})`);
    console.log(`[STATUS] Connected Conversations: ${connectedConversationsCount}/${TARGET_CONNECTED_CALLS}`);
    console.log(`--------------------------------------------------------------------------------`);

    // 1. Mark as calling in DB
    await supabase
      .from('leads')
      .update({
        voice_campaign_id: campaignId,
        voice_call_status: 'calling',
        voice_call_retry_count: 0,
        voice_recording_url: null,
        last_call_at: new Date().toISOString()
      })
      .eq('id', lead.id);

    // 2. Pre-warm Gemini session
    try {
      await fetch('https://gemini-voice-bridge-805895515412.us-central1.run.app/prewarm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: lead.id, profileId: userId, campaignId, voiceName: 'Aoede' })
      });
    } catch (pwErr) {}

    // 3. Dial via Vobiz REST API
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
      console.log(`[VOBIZ RESPONSE] Status: ${res.status}, UUID: ${callUuid}`);

      if (!res.ok) {
        console.warn(`[DIAL FAILED] Call rejected by Vobiz:`, data);
        await supabase.from('leads').update({ voice_call_status: 'failed' }).eq('id', lead.id);
        await sleep(2000);
        continue;
      }
    } catch (dErr) {
      console.error(`[NETWORK ERROR] Dialing ${lead.phone} failed:`, dErr.message);
      continue;
    }

    // 4. Monitor call in progress (wait up to 90 seconds)
    process.stdout.write(`[RINGING/TALKING] `);
    let callEnded = false;
    let finalStatus = 'calling';
    const startTime = Date.now();
    let recTriggered = false;

    while (!callEnded && (Date.now() - startTime) < 90000) {
      await sleep(3500);
      const { data: curLead } = await supabase
        .from('leads')
        .select('voice_call_status')
        .eq('id', lead.id)
        .single();

      finalStatus = curLead?.voice_call_status || finalStatus;

      // Ensure dual recording
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
        console.log(`\n[CALL FINISHED] Outcome: ${finalStatus}`);
        break;
      }
      process.stdout.write(`.`);
    }

    if (!callEnded) {
      console.log(`\n[CALL TIMEOUT] No termination event after 90s.`);
    }

    // Brief delay for audio / webhook finalize
    await sleep(4000);

    // Sync recording if completed
    let publicAudioUrl = null;
    if (callUuid && finalStatus === 'completed') {
      publicAudioUrl = await syncVobizRecording(lead.id, callUuid, authId, authToken);
    }

    // Fetch call summary and transcript
    const { data: postLead } = await supabase
      .from('leads')
      .select('name, phone, voice_call_status, voice_call_summary, voice_recording_url, voice_call_transcript, pipeline_stage')
      .eq('id', lead.id)
      .single();

    const transcript = postLead?.voice_call_transcript || [];
    const isAnswered = Array.isArray(transcript) && transcript.length > 0;
    // Connected conversation: prospect answered and engaged (>= 2 dialogue turns)
    const isConnectedConversation = Array.isArray(transcript) && transcript.length >= 2;

    if (isAnswered) answeredCount++;
    if (isConnectedConversation) {
      connectedConversationsCount++;
      console.log(`\n⭐ [SUCCESSFUL CONNECTED CALL #${connectedConversationsCount}/${TARGET_CONNECTED_CALLS}] Connected with ${lead.name || 'Prospect'}!`);
      if (postLead?.voice_call_summary) {
        console.log(`[AI SUMMARY] ${postLead.voice_call_summary}`);
      }
    } else {
      console.log(`[CALL RESULT] Status: ${finalStatus} | Turns: ${transcript.length}`);
    }

    // Post-call notifications for high intent
    if (finalStatus === 'completed' && postLead) {
      const summaryText = (postLead.voice_call_summary || '').toLowerCase();
      const isNotInterested = summaryText.includes('not interested') || summaryText.includes('disinterest') || summaryText.includes('no interest') || summaryText.includes('accidental');
      const isInterested = !isNotInterested && (summaryText.includes('interested') || summaryText.includes('inquired') || summaryText.includes('looking for') || summaryText.includes('rates') || summaryText.includes('callback'));
      const isBooked = summaryText.includes('booked') || summaryText.includes('scheduled a visit') || summaryText.includes('callback scheduled');

      if (isBooked || isInterested) {
        try {
          await fetch('https://app.nobogent.com/api/voice/post-call-notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              leadId: lead.id,
              profileId: userId,
              isQualified: true,
              leadPriority: 'HOT',
              summary: postLead.voice_call_summary || '',
              skipProspectWhatsApp: true
            })
          });
          console.log(`[ADMIN NOTIFY] 🔔 Lead flagged as High Intent: ${lead.name}`);
        } catch (nErr) {}
      }
    }

    console.log(`[PROGRESS] Dialed: ${dialedCount} | Answered: ${answeredCount} | Successful Connected: ${connectedConversationsCount}/${TARGET_CONNECTED_CALLS}\n`);

    // Polite pause between calls
    await sleep(4000);
  }

  console.log('========================================================');
  console.log('[CAMPAIGN EXECUTION SUMMARY]');
  console.log(`Total Leads Dialed: ${dialedCount}`);
  console.log(`Total Answered: ${answeredCount}`);
  console.log(`Total Connected Conversations: ${connectedConversationsCount}`);
  console.log('========================================================');
}

runRajivCsvCampaign().catch(console.error);

