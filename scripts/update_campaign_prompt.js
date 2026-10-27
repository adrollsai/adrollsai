const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function updateCampPrompt() {
  const campId = '76e6b0ad-7a88-45fb-8189-7844074d1957';
  const { data: camp, error: fetchErr } = await supabaseAdmin
    .from('voice_campaigns')
    .select('custom_prompt')
    .eq('id', campId)
    .single();

  if (fetchErr || !camp) {
    console.error('Failed to fetch campaign:', fetchErr);
    return;
  }

  let prompt = camp.custom_prompt || '';
  const searchPattern = /- SHORT & CRISP TURNS: Keep every response UNDER 15-20 WORDS[^\n]*/;
  const replacement = `- BE LESS TALKATIVE, LISTEN MORE: Keep every response UNDER 10-15 WORDS (1 short sentence max). Never give long pitches, lectures, or monologues. Speak less, listen more. Give the prospect maximum space to speak.
- ACTIVE LISTENING & HUMAN SOUNDS: While listening and acknowledging the caller, use natural human verbal nods and conversational fillers like "Hmm...", "Ahan...", "Haan ji...", "Achha...", "Ji bilkul...". Frequently start turns with these natural human fillers so it feels completely human, attentive, and engaged on the phone.`;

  if (searchPattern.test(prompt)) {
    prompt = prompt.replace(searchPattern, replacement);
  } else {
    prompt = replacement + '\n' + prompt;
  }

  const { error: updateErr } = await supabaseAdmin
    .from('voice_campaigns')
    .update({ custom_prompt: prompt })
    .eq('id', campId);

  if (updateErr) {
    console.error('Failed to update campaign:', updateErr);
  } else {
    console.log('Successfully updated campaign custom_prompt in Supabase!');
  }
}

updateCampPrompt();
