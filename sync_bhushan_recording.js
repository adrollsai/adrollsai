const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function syncRecording() {
  const authId = 'MA_HOSGFZ86';
  const authToken = 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU';
  const leadId = '91bb4de2-8b61-454f-81cb-8b976bc7496f';
  const vobizUrl = 'https://media.vobiz.ai/v1/Account/MA_HOSGFZ86/Recording/5ca25323-a74d-40d6-b721-c66fc778b6a4.mp3';

  console.log('Downloading 67s MP3 recording from Vobiz...');
  const res = await fetch(vobizUrl, {
    headers: {
      'X-Auth-ID': authId,
      'X-Auth-Token': authToken
    }
  });

  if (!res.ok) throw new Error('Download failed: ' + res.status);
  const buffer = Buffer.from(await res.arrayBuffer());
  console.log('Downloaded bytes:', buffer.length);

  const fileName = leadId + '/vobiz_' + Date.now() + '.mp3';
  const { error: upErr } = await supabase.storage
    .from('lead-voice-recordings')
    .upload(fileName, buffer, {
      contentType: 'audio/mpeg',
      upsert: true
    });

  if (upErr) throw upErr;

  const { data: pubData } = supabase.storage
    .from('lead-voice-recordings')
    .getPublicUrl(fileName);

  const publicUrl = pubData.publicUrl;
  console.log('Public Supabase Audio URL:', publicUrl);

  await supabase.from('leads').update({
    voice_recording_url: publicUrl
  }).eq('id', leadId);

  // Also update latest history entry
  const { data: latestHist } = await supabase.from('lead_history')
    .select('id, description')
    .eq('lead_id', leadId)
    .ilike('description', '%CALL_JSON%')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (latestHist) {
    try {
      const parsed = JSON.parse(latestHist.description.replace('🎙️ CALL_JSON:', '').trim());
      parsed.recording_url = publicUrl;
      await supabase.from('lead_history').update({
        description: '🎙️ CALL_JSON:' + JSON.stringify(parsed)
      }).eq('id', latestHist.id);
    } catch (e) {}
  }

  console.log('SUCCESS! Audio synced to Supabase storage and saved to lead record.');
}

syncRecording().catch(console.error);
