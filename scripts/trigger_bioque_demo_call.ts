import { createClient } from '@supabase/supabase-js';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

import { triggerOutboundCall } from '../utils/voice-helper';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function runDemoCall() {
  const userId = '68b55a31-a16d-454d-a20f-11adabf590b0'; // Bioque Estates International
  const targetPhone = '+918288835235';
  const voiceCampaignId = '76e6b0ad-7a88-45fb-8189-7844074d1957'; // Amritsar Omaxe Residential Plots
  const metaCampaignId = '120251733398810304';
  const propertyId = '16adb76b-4f7e-462c-8b70-ce058123a383'; // Omaxe Amritsar property

  console.log(`[DEMO CALL] Preparing demo call for Bioque Estates to ${targetPhone}...`);

  // 1. Verify Profile Voice settings & Credits
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, credits, voice_provider, voice_name, voice_twilio_number, auto_call_new_leads, business_name')
    .eq('id', userId)
    .single();

  console.log('[DEMO CALL] Profile Settings:', {
    businessName: profile?.business_name,
    credits: profile?.credits,
    voiceProvider: profile?.voice_provider,
    voiceName: profile?.voice_name,
    callerId: profile?.voice_twilio_number,
    autoCallEnabled: profile?.auto_call_new_leads
  });

  // 2. Fetch or create the lead with exact Amritsar campaign attribution
  let { data: lead } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('user_id', userId)
    .ilike('phone', '%8288835235%')
    .maybeSingle();

  const customFields = {
    meta_ad_origin: {
      campaign_id: metaCampaignId,
      campaign_name: 'OMAXE AMRITSAR - Residential Plots',
      product_name: 'OMAXE AMRITSAR - Residential Plots',
      form_id: '1748555089587784',
      headline: 'Premium Residential Plots in Amritsar starting @ ₹60 Lacs'
    },
    interested_property: 'OMAXE AMRITSAR - Residential Plots',
    investment_budget: '60L - 70L',
    purchase_timeline: 'Immediate (< 1 Month)',
    preferred_plot_size: '300 Sq. Yds.',
    source: 'Facebook Lead Ad (Amritsar Omaxe)'
  };

  if (!lead) {
    console.log('[DEMO CALL] Creating new lead for Amritsar plots...');
    const { data: newLead, error: createErr } = await supabaseAdmin
      .from('leads')
      .insert({
        user_id: userId,
        name: 'Raman',
        phone: targetPhone,
        source: 'Facebook Lead Ad (Amritsar Omaxe)',
        campaign_id: metaCampaignId,
        voice_campaign_id: voiceCampaignId,
        property_id: propertyId,
        custom_fields: customFields,
        pipeline_stage: 'New Lead',
        status: 'New Lead',
        voice_call_status: null
      })
      .select()
      .single();

    if (createErr || !newLead) {
      console.error('[DEMO CALL] Error creating lead:', createErr);
      return;
    }
    lead = newLead;
  } else {
    console.log(`[DEMO CALL] Updating existing lead ${lead.id}...`);
    const { data: updatedLead, error: updateErr } = await supabaseAdmin
      .from('leads')
      .update({
        name: lead.name || 'Raman',
        campaign_id: metaCampaignId,
        voice_campaign_id: voiceCampaignId,
        property_id: propertyId,
        custom_fields: customFields,
        voice_call_status: null,
        voice_call_scheduled_at: null,
        voice_call_retry_count: 0
      })
      .eq('id', lead.id)
      .select()
      .single();

    if (updateErr) {
      console.error('[DEMO CALL] Error updating lead:', updateErr);
      return;
    }
    lead = updatedLead;
  }

  console.log(`[DEMO CALL] Triggering outbound call via triggerOutboundCall for lead ${lead.id}...`);
  const result = await triggerOutboundCall(supabaseAdmin, lead.id, userId, false, voiceCampaignId);
  console.log('[DEMO CALL] Outbound Call Result:', JSON.stringify(result, null, 2));
}

runDemoCall().catch(console.error);
