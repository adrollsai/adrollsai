const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function setupBioqueFlow() {
  const bioqueId = '68b55a31-a16d-454d-a20f-11adabf590b0';
  const campaignId = '120251551605320304';
  const flowName = 'Dubai Luxury Real Estate Qualification Flow';

  const questionsPayload = [
    {
      type: 'choice',
      question: 'What is your budget range?',
      options: ['3 Cr - 4 Cr', '4 Cr - 5 Cr', 'Above 5 Cr']
    },
    {
      type: 'choice',
      question: 'When are you looking to buy?',
      options: ['This Month', 'Next Month', 'Within 3 Months']
    },
    {
      _type: 'flow_completion',
      action: 'catalog',
      title: 'View Dubai Catalogue 🏢',
      message: 'Thank you for sharing your preferences! Here is our curated portfolio of luxury properties in Dubai and Tri-City.',
      button_text: 'Explore Properties 🏙️',
      url: 'https://bioqueestatesinternational.com'
    }
  ];

  // 1. Enable qualifying in profile
  const { error: profileErr } = await supabaseAdmin
    .from('profiles')
    .update({
      qualifying_enabled: true,
      qualifying_questions: questionsPayload
    })
    .eq('id', bioqueId);

  if (profileErr) {
    console.error('Error updating profile:', profileErr);
  } else {
    console.log('✅ Profile qualifying_enabled set to TRUE');
  }

  // 2. Check if a flow already exists for this campaign
  const { data: existingFlows } = await supabaseAdmin
    .from('whatsapp_question_flows')
    .select('id')
    .eq('user_id', bioqueId)
    .eq('linked_campaign_id', campaignId);

  if (existingFlows && existingFlows.length > 0) {
    const { error: updateErr } = await supabaseAdmin
      .from('whatsapp_question_flows')
      .update({
        name: flowName,
        is_active: true,
        questions: questionsPayload
      })
      .eq('id', existingFlows[0].id);

    if (updateErr) console.error('Error updating existing flow:', updateErr);
    else console.log(`✅ Updated existing flow ID ${existingFlows[0].id}`);
  } else {
    const { data: newFlow, error: insertErr } = await supabaseAdmin
      .from('whatsapp_question_flows')
      .insert({
        user_id: bioqueId,
        name: flowName,
        linked_campaign_id: campaignId,
        is_active: true,
        questions: questionsPayload
      })
      .select('id')
      .single();

    if (insertErr) console.error('Error creating question flow:', insertErr);
    else console.log(`✅ Created new question flow ID: ${newFlow.id}`);
  }

  // 3. Verify lookup exactly as webhook does (lines 3950-3965 of facebook route)
  const { data: matchedFlow, error: matchErr } = await supabaseAdmin
    .from('whatsapp_question_flows')
    .select('id, questions, name, is_active')
    .eq('user_id', bioqueId)
    .eq('linked_campaign_id', campaignId)
    .maybeSingle();

  console.log('Verification test for webhook matching:');
  console.log('Matched Flow ID:', matchedFlow?.id);
  console.log('Matched Flow Name:', matchedFlow?.name);
  console.log('Active:', matchedFlow?.is_active);
  console.log('Questions count:', matchedFlow?.questions?.length);
}

setupBioqueFlow();
