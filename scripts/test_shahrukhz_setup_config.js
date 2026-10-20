const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testConfig() {
  const userId = '68b55a31-a16d-454d-a20f-11adabf590b0';
  const voiceCampaignId = 'bee2bf56-cd5b-4646-8120-a3498f4acf95';
  const targetPhone = '+918288835235';

  // 1. Create or update test lead with realistic Facebook form answers for Shahrukhz
  const formAnswers = {
    meta_ad_origin: {
      campaign_id: '120251924470700304',
      campaign_name: 'Shahrukhz Residences | Danube Maritime City | 19-10-2026',
      product_name: 'SHAHRUKHZ RESIDENCES BY DANUBE',
      form_id: '1885013402872435',
      form_name: 'Shahrukhz Residences Danube | Higher Intent Qualifying Form | 19-10-2026',
      headline: '👑 Live Life King Style at Shahrukhz Residences by Danube'
    },
    planned_budget: 'AED 3M - AED 5M (~₹6.8 Cr - ₹11.4 Cr) [2 BHK]',
    preferred_configuration: '2 BHK Waterfront Residence (From AED 4.25M)',
    booking_timeline: 'Immediate Priority EOI (AED 50K - 100K)',
    investment_goal: 'Iconic Waterfront Living & Yacht Lifestyle',
    funding_readiness: '10% Down Payment Ready + 30:70 Payment Plan',
    city: 'Chandigarh',
    is_instant_form: true,
    qualification_completed: true
  };

  let { data: lead } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('user_id', userId)
    .ilike('phone', '%8288835235%')
    .maybeSingle();

  if (!lead) {
    console.log('Creating test lead for +918288835235...');
    const { data: newLead, error } = await supabaseAdmin
      .from('leads')
      .insert({
        user_id: userId,
        name: 'Raman',
        phone: targetPhone,
        source: 'Facebook Ads',
        campaign_id: '120251924470700304',
        form_id: '1885013402872435',
        voice_campaign_id: voiceCampaignId,
        property_id: 'b8007315-e951-4005-9ced-8aa9f190a231',
        custom_fields: formAnswers,
        pipeline_stage: 'New Lead',
        status: 'New Lead'
      })
      .select()
      .single();
    if (error) throw error;
    lead = newLead;
  } else {
    console.log('Updating test lead for +918288835235...');
    const { data: updatedLead, error } = await supabaseAdmin
      .from('leads')
      .update({
        name: lead.name || 'Raman',
        source: 'Facebook Ads',
        campaign_id: '120251924470700304',
        form_id: '1885013402872435',
        voice_campaign_id: voiceCampaignId,
        property_id: 'b8007315-e951-4005-9ced-8aa9f190a231',
        custom_fields: formAnswers,
        voice_call_status: null,
        voice_call_scheduled_at: null,
        voice_call_retry_count: 0
      })
      .eq('id', lead.id)
      .select()
      .single();
    if (error) throw error;
    lead = updatedLead;
  }

  console.log('Lead ID:', lead.id, 'Name:', lead.name, 'Phone:', lead.phone);
}

testConfig().catch(console.error);
