import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { triggerVobizOutboundCall } from '../utils/vobiz-helper';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

process.on('uncaughtException', (err) => {
  console.error('🔥 Global uncaughtException:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 Global unhandledRejection:', reason);
});

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const GNR_USER_ID = '42d2e0c5-4fe6-4738-8a9f-63f09be01f12';
const CAMPAIGN_ID = '61fcdf4c-59d0-48d0-ba9b-428ae7d62a14';
const TARGET_CONNECTED_CALLS = 100; // Dial through all remaining callable leads

interface CallReportItem {
  leadId: string;
  name: string;
  phone: string;
  adName: string;
  status: 'connected' | 'not_answered' | 'busy' | 'failed';
  durationSeconds?: number;
  appointmentBooked: boolean;
  bookedSlot?: string;
  summary?: string;
  transcript?: any[];
  recordingUrl?: string;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runCampaign() {
  console.log('====================================================');
  console.log('🚀 GNR HOMES — AI CALLING CAMPAIGN (ALL REMAINING LEADS)');
  console.log('Target: Call All Remaining Callable Leads in Queue');
  console.log(`Campaign ID: ${CAMPAIGN_ID}`);
  console.log(`Caller CLI: +917965480715 (Vobiz India)`);
  console.log('====================================================\n');

  // 1. Fetch eligible Housing.com leads (fresh uncalled first, then earlier unanswered)
  const { data: freshLeads } = await supabaseAdmin
    .from('leads')
    .select('id, name, phone, ad_name, voice_call_status, notes, custom_fields')
    .eq('user_id', GNR_USER_ID)
    .ilike('source', '%housing%')
    .in('voice_call_status', ['not_called', null, 'queued'])
    .order('created_at', { ascending: false });

  const { data: retryLeads } = await supabaseAdmin
    .from('leads')
    .select('id, name, phone, ad_name, voice_call_status, notes, custom_fields')
    .eq('user_id', GNR_USER_ID)
    .ilike('source', '%housing%')
    .in('voice_call_status', ['no_answer', 'busy', 'failed'])
    .order('created_at', { ascending: false });

  const leads = [...(freshLeads || []), ...(retryLeads || [])];

  if (!leads || leads.length === 0) {
    console.error('❌ Failed to fetch leads or no eligible leads found');
    return;
  }

  console.log(`📋 Found ${leads.length} leads ready for calling (${freshLeads?.length || 0} fresh, ${retryLeads?.length || 0} retryable).\n`);

  const reports: CallReportItem[] = [];
  let connectedCount = 0;
  let attemptCount = 0;

  for (const lead of leads) {
    if (connectedCount >= TARGET_CONNECTED_CALLS) {
      console.log(`\n🎉 Reached target of ${TARGET_CONNECTED_CALLS} successfully connected calls!`);
      break;
    }

    if (!lead.phone) {
      console.log(`⚠️ Skipping lead ${lead.name} (${lead.id}): No phone number.`);
      continue;
    }

    attemptCount++;
    console.log(`----------------------------------------------------`);
    console.log(`📞 [Call #${attemptCount}] Dialing (Fenrir Voice): ${lead.name} (${lead.phone})`);
    console.log(`   Property Inquiry: ${lead.ad_name || 'Mohali Property'}`);

    // Trigger outbound call with Fenrir voice
    const callRes = await triggerVobizOutboundCall(supabaseAdmin, {
      leadId: lead.id,
      profileId: GNR_USER_ID,
      toPhone: lead.phone,
      campaignId: CAMPAIGN_ID,
      voiceName: 'Fenrir'
    });

    if (!callRes.success && !callRes.callUuid) {
      console.log(`   ❌ Call trigger failed: ${callRes.error || 'Unknown error'}`);
      reports.push({
        leadId: lead.id,
        name: lead.name,
        phone: lead.phone,
        adName: lead.ad_name,
        status: 'failed',
        appointmentBooked: false,
        summary: callRes.error
      });
      await sleep(3000);
      continue;
    }

    console.log(`   📡 Call dispatched (UUID: ${callRes.callUuid || 'initiated'}). Waiting for call lifecycle...`);

    // Poll for call completion (max 210 seconds)
    const startTime = Date.now();
    const maxWaitMs = 210 * 1000;
    let finalLeadState: any = null;

    while (Date.now() - startTime < maxWaitMs) {
      await sleep(5000);

      try {
        const { data: updatedLead, error: pollErr } = await supabaseAdmin
          .from('leads')
          .select('id, name, phone, voice_call_status, voice_call_summary, voice_call_transcript, voice_recording_url, pipeline_stage, notes, booked_time')
          .eq('id', lead.id)
          .single();

        if (pollErr) {
          console.warn(`   ⚠️ Polling warning: ${pollErr.message}`);
          continue;
        }

        if (!updatedLead) break;

        const st = updatedLead.voice_call_status;
        console.log(`   ⏳ Call status: ${st} (${Math.round((Date.now() - startTime) / 1000)}s)`);

        if (['completed', 'no_answer', 'failed', 'busy', 'not_picked', 'cancelled'].includes(st)) {
          // Wait 5 seconds for async post-call webhook to persist summary & transcript
          await sleep(5000);
          const { data: refreshedLead } = await supabaseAdmin
            .from('leads')
            .select('id, name, phone, voice_call_status, voice_call_summary, voice_call_transcript, voice_recording_url, pipeline_stage, notes, booked_time')
            .eq('id', lead.id)
            .single();
          finalLeadState = refreshedLead || updatedLead;
          break;
        }
      } catch (err: any) {
        console.warn(`   ⚠️ Supabase poll catch: ${err?.message || err}`);
      }
    }

    if (!finalLeadState) {
      const { data: fallbackLead } = await supabaseAdmin
        .from('leads')
        .select('id, name, phone, voice_call_status, voice_call_summary, voice_call_transcript, voice_recording_url, pipeline_stage, notes, booked_time')
        .eq('id', lead.id)
        .single();
      finalLeadState = fallbackLead;
    }

    const finalStatus = finalLeadState?.voice_call_status || 'no_answer';
    const isConnected = finalStatus === 'completed' || (Array.isArray(finalLeadState?.voice_call_transcript) && finalLeadState.voice_call_transcript.length > 0);
    const isBooked = finalLeadState?.pipeline_stage === 'APPOINTMENT_BOOKED' || !!finalLeadState?.booked_time || (finalLeadState?.notes && finalLeadState.notes.includes('Booked via AI Call'));

    let reportStatus: 'connected' | 'not_answered' | 'busy' | 'failed' = 'not_answered';
    if (isConnected) {
      reportStatus = 'connected';
      connectedCount++;
      console.log(`   ✅ CALL CONNECTED & COMPLETED! (Connected count: ${connectedCount}/${TARGET_CONNECTED_CALLS})`);
      if (isBooked) {
        console.log(`   🎯 APPOINTMENT BOOKED! Notes: ${finalLeadState?.notes?.split('\n')[0]}`);
      }
      if (finalLeadState?.voice_call_summary) {
        console.log(`   📝 Summary: ${finalLeadState.voice_call_summary}`);
      }
    } else if (finalStatus === 'busy') {
      reportStatus = 'busy';
      console.log(`   📵 Lead was busy / rejected.`);
    } else {
      reportStatus = 'not_answered';
      console.log(`   ⚠️ Lead did not answer (DNP / No answer).`);
    }

    reports.push({
      leadId: lead.id,
      name: lead.name,
      phone: lead.phone,
      adName: lead.ad_name,
      status: reportStatus,
      appointmentBooked: isBooked,
      bookedSlot: finalLeadState?.booked_time,
      summary: finalLeadState?.voice_call_summary,
      transcript: finalLeadState?.voice_call_transcript,
      recordingUrl: finalLeadState?.voice_recording_url
    });

    console.log(`   Progress: ${connectedCount}/${TARGET_CONNECTED_CALLS} connected calls completed.\n`);

    // Pacing delay between calls
    if (connectedCount < TARGET_CONNECTED_CALLS) {
      console.log('   Pacing: waiting 10s before next call...');
      await sleep(10000);
    }
  }

  // Save report to JSON file
  const reportPath = path.join(__dirname, `gnr_campaign_report_all_leads_${Date.now()}.json`);
  const fs = await import('fs');
  fs.writeFileSync(reportPath, JSON.stringify(reports, null, 2));

  console.log('\n====================================================');
  console.log(`📊 CAMPAIGN RUN SUMMARY`);
  console.log(`Total Attempts: ${attemptCount}`);
  console.log(`Successfully Connected: ${connectedCount}`);
  console.log(`Not Answered / Busy: ${attemptCount - connectedCount}`);
  console.log(`Appointments Booked: ${reports.filter(r => r.appointmentBooked).length}`);
  console.log(`Detailed Report saved to: ${reportPath}`);
  console.log('====================================================');
}

runCampaign().catch(console.error);
