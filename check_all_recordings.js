const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkRecordings() {
  const authId = 'MA_HOSGFZ86';
  const authToken = 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU';

  // 1. Check leads with completed calls or any call status
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, name, phone, voice_call_status, voice_recording_url, voice_call_transcript, custom_fields, created_at')
    .not('voice_call_status', 'is', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching leads:', error);
    return;
  }

  console.log(`Total leads with voice_call_status: ${leads.length}`);

  let hasRec = 0;
  let missingRecCompleted = [];
  let notCompleted = 0;

  for (const l of leads) {
    const isAnswered = Array.isArray(l.voice_call_transcript) && l.voice_call_transcript.length > 0;
    const isCompleted = l.voice_call_status === 'completed' || isAnswered;

    if (l.voice_recording_url) {
      hasRec++;
    } else {
      if (isCompleted) {
        missingRecCompleted.push(l);
      } else {
        notCompleted++;
      }
    }
  }

  console.log(`Leads with voice_recording_url: ${hasRec}`);
  console.log(`Leads completed/answered WITHOUT recording_url: ${missingRecCompleted.length}`);
  console.log(`Leads not answered/failed without recording_url: ${notCompleted}`);

  // Let's sample the ones missing recordings
  console.log('\n--- Checking first 10 leads missing recording on Vobiz API ---');
  for (let i = 0; i < Math.min(10, missingRecCompleted.length); i++) {
    const lead = missingRecCompleted[i];
    const callUuid = lead.custom_fields?.last_vobiz_call_uuid;
    console.log(`Lead: ${lead.name} (${lead.phone}) | CallUuid: ${callUuid}`);
    
    if (callUuid) {
      try {
        const listRes = await fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/Recording/?call_uuid=${callUuid}`, {
          headers: { 'X-Auth-ID': authId, 'X-Auth-Token': authToken }
        });
        const listData = await listRes.json();
        console.log(`  -> Vobiz API objects count: ${listData.objects?.length || 0}`);
        if (listData.objects?.length > 0) {
          console.log(`  -> Vobiz Recording Found! URL: ${listData.objects[0].recording_url}`);
        }
      } catch (e) {
        console.log(`  -> Vobiz API error:`, e.message);
      }
    } else {
      console.log(`  -> No callUuid stored in custom_fields!`);
    }
  }

  // Also check Vobiz CDR / Recording API generally to see total recordings available on Vobiz
  console.log('\n--- Fetching recent recordings directly from Vobiz API ---');
  try {
    const vobizRecsRes = await fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/Recording/?limit=20`, {
      headers: { 'X-Auth-ID': authId, 'X-Auth-Token': authToken }
    });
    if (vobizRecsRes.ok) {
      const vobizRecs = await vobizRecsRes.json();
      console.log(`Total recordings returned in recent page: ${vobizRecs.objects?.length || 0}`);
      if (vobizRecs.objects?.length > 0) {
        console.log(`Sample recording object:`, JSON.stringify(vobizRecs.objects[0], null, 2));
      }
    } else {
      console.log('Vobiz Recording API status:', vobizRecsRes.status);
    }
  } catch (e) {
    console.log('Error querying Vobiz Recordings:', e.message);
  }
}

checkRecordings();
