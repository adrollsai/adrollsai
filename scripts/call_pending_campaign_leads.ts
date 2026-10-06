import { createClient } from '@supabase/supabase-js';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

import { triggerOutboundCall } from '../utils/voice-helper';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const userId = '68b55a31-a16d-454d-a20f-11adabf590b0';

async function callPendingLeads() {
  console.log('[CALL PENDING] Checking pending leads for Bioque Estates campaigns...');

  // Target leads that need calling
  const pendingLeadIds = [
    {
      id: '535ae500-2dff-40bb-8fc4-2169730c0f39', // Anil Narang
      name: 'Anil Narang',
      phone: '+919316611911',
      campaignName: 'Omaxe New Chandigarh',
      voiceCampaignId: '7b081a8c-a067-48ba-ad68-9da78d40da28'
    },
    {
      id: '0e2d9e3c-879d-46f0-8193-3d89f631bd28', // Sardul Gill
      name: 'Sardul Gill',
      phone: '+919464640123',
      campaignName: 'Amritsar Omaxe Plots',
      voiceCampaignId: '76e6b0ad-7a88-45fb-8189-7844074d1957'
    }
  ];

  for (const item of pendingLeadIds) {
    console.log(`\n======================================================`);
    console.log(`Dialing pending lead: ${item.name} (${item.phone}) for ${item.campaignName}...`);
    
    // Ensure voice_campaign_id is set
    await supabaseAdmin
      .from('leads')
      .update({
        voice_campaign_id: item.voiceCampaignId,
        voice_call_status: null
      })
      .eq('id', item.id);

    try {
      const res = await triggerOutboundCall(supabaseAdmin, item.id, userId, false, item.voiceCampaignId);
      console.log(`Result for ${item.name}:`, JSON.stringify(res, null, 2));
    } catch (e: any) {
      console.error(`Error calling ${item.name}:`, e.message);
    }

    // Small delay between calls
    await new Promise(r => setTimeout(r, 2000));
  }
}

callPendingLeads().catch(console.error);
