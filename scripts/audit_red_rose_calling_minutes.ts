import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function fullAudit() {
  const userId = 'c3893924-5a57-4da3-b4bc-7c70d8ee7c59';
  const redRoseNumber = '+917965853573';
  const cleanRedRoseNum = '917965853573';

  // 1. Fetch all leads for Red Rose City
  const { data: leads, error: leadErr } = await supabase
    .from('leads')
    .select('id, name, phone, voice_call_status, voice_call_summary, voice_call_transcript, custom_fields, created_at')
    .eq('user_id', userId);

  if (leadErr) {
    console.error("Error fetching leads:", leadErr);
    return;
  }

  console.log('=== 1. RED ROSE CITY CRM LEADS ===');
  console.log('Total Leads:', leads?.length);

  const phoneMap = new Map();
  (leads || []).forEach(l => {
    if (l.phone) {
      const clean = l.phone.replace(/\D/g, '').slice(-10);
      if (clean) phoneMap.set(clean, l);
    }
  });
  console.log('Unique 10-digit lead phone numbers:', phoneMap.size);

  const statusMap: Record<string, number> = {};
  leads?.forEach(l => {
    const s = l.voice_call_status || 'null/not_set';
    statusMap[s] = (statusMap[s] || 0) + 1;
  });
  console.log('CRM Voice Status Breakdown:', statusMap);

  // 2. Fetch ALL calls from Vobiz sub-account SA_5USUA60B
  const subAuthId = 'SA_5USUA60B';
  const subAuthToken = 'QaHZT4bjxpUdu1iokTsMXn2xN2X8slvKuox2hy7JKgcZvnlYSg8vaazw7nAIbMjz';

  let subCalls: any[] = [];
  let offset = 0;
  while (true) {
    const res = await fetch(`https://api.vobiz.ai/api/v1/Account/${subAuthId}/Call/?limit=20&offset=${offset}`, {
      headers: { 'X-Auth-ID': subAuthId, 'X-Auth-Token': subAuthToken }
    });
    const data = await res.json();
    if (!data.objects || data.objects.length === 0) break;
    subCalls.push(...data.objects);
    if (!data.meta?.next) break;
    offset += 20;
  }

  console.log('\n=== 2. VOBIZ SUB-ACCOUNT (SA_5USUA60B) CALLS ===');
  console.log('Total calls retrieved:', subCalls.length);

  let subTotalBillSec = 0;
  let subAnsweredCount = 0;
  let subUnansweredCount = 0;
  const subHangupCauses: Record<string, number> = {};
  const detailedSubCalls: any[] = [];

  subCalls.forEach(c => {
    const billSec = Number(c.bill_duration) || 0;
    subTotalBillSec += billSec;
    const isAnswered = Boolean(c.answer_time);
    if (isAnswered) {
      subAnsweredCount++;
    } else {
      subUnansweredCount++;
    }
    const cause = c.hangup_cause_name || 'Unknown';
    subHangupCauses[cause] = (subHangupCauses[cause] || 0) + 1;

    detailedSubCalls.push({
      call_uuid: c.call_uuid,
      to_number: c.to_number,
      from_number: c.from_number,
      bill_duration_sec: billSec,
      bill_duration_min: (billSec / 60).toFixed(2),
      cost: c.cost,
      currency: c.currency,
      answer_time: c.answer_time,
      initiation_time: c.initiation_time,
      end_time: c.end_time,
      hangup_cause: cause
    });
  });

  console.log('Answered calls (connected):', subAnsweredCount);
  console.log('Unanswered / rejected calls:', subUnansweredCount);
  console.log('Hangup causes:', subHangupCauses);
  console.log(`Sub-account Total Duration: ${subTotalBillSec} seconds = ${(subTotalBillSec / 60).toFixed(2)} minutes (${Math.floor(subTotalBillSec / 60)} min ${subTotalBillSec % 60} sec)`);

  // 3. Check Vobiz Master Account MA_HOSGFZ86
  const mainAuthId = process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86';
  const mainAuthToken = process.env.VOBIZ_AUTH_TOKEN!;

  let mainCalls: any[] = [];
  offset = 0;
  while (true) {
    const res = await fetch(`https://api.vobiz.ai/api/v1/Account/${mainAuthId}/Call/?limit=20&offset=${offset}`, {
      headers: { 'X-Auth-ID': mainAuthId, 'X-Auth-Token': mainAuthToken }
    });
    if (!res.ok) {
      console.log('Master account fetch status:', res.status);
      break;
    }
    const data = await res.json();
    if (!data.objects || data.objects.length === 0) break;
    mainCalls.push(...data.objects);
    if (!data.meta?.next || mainCalls.length >= 2000) break;
    offset += 20;
  }
  console.log('\n=== 3. VOBIZ MASTER ACCOUNT (MA_HOSGFZ86) CALLS ===');
  console.log('Total calls in master account fetched:', mainCalls.length);

  const redRoseMainCalls = mainCalls.filter(c => {
    const fromClean = (c.from_number || '').replace(/\D/g, '').slice(-10);
    const toClean = (c.to_number || '').replace(/\D/g, '').slice(-10);
    const isFromRedRose = fromClean === cleanRedRoseNum.slice(-10);
    const isToRedRoseLead = phoneMap.has(toClean);
    return isFromRedRose || isToRedRoseLead;
  });

  console.log('Master account calls matching Red Rose City (by DID or Lead Phone):', redRoseMainCalls.length);
  let mainTotalBillSec = 0;
  redRoseMainCalls.forEach(c => {
    const billSec = Number(c.bill_duration) || 0;
    mainTotalBillSec += billSec;
  });
  console.log(`Master account Red Rose Duration: ${mainTotalBillSec} seconds = ${(mainTotalBillSec / 60).toFixed(2)} minutes`);

  // De-duplicate any calls present in both subCalls and redRoseMainCalls
  const subUuids = new Set(subCalls.map(c => c.call_uuid));
  const uniqueMasterCalls = redRoseMainCalls.filter(c => !subUuids.has(c.call_uuid));
  console.log('Master calls not in sub-account:', uniqueMasterCalls.length);

  // 4. Twilio check
  const twilioSid = process.env.MASTER_TWILIO_SID;
  const twilioToken = process.env.MASTER_TWILIO_TOKEN;
  let twilioDurationSec = 0;
  let twilioCallsCount = 0;

  if (twilioSid && twilioToken) {
    console.log('\n=== 4. MASTER TWILIO ACCOUNT CHECK ===');
    const authHeader = 'Basic ' + Buffer.from(twilioSid + ':' + twilioToken).toString('base64');
    let twUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Calls.json?PageSize=100`;
    let pageCount = 0;
    while (twUrl && pageCount < 10) {
      const twRes = await fetch(twUrl, {
        headers: { 'Authorization': authHeader }
      });
      if (!twRes.ok) break;
      const twData = await twRes.json();
      const pageCalls = twData.calls || [];
      const twRedRose = pageCalls.filter((c: any) => {
        const toClean = (c.to || '').replace(/\D/g, '').slice(-10);
        const fromClean = (c.from || '').replace(/\D/g, '').slice(-10);
        return phoneMap.has(toClean) || phoneMap.has(fromClean) || fromClean === cleanRedRoseNum.slice(-10);
      });
      for (const c of twRedRose) {
        twilioCallsCount++;
        twilioDurationSec += (Number(c.duration) || 0);
      }
      twUrl = twData.next_page_uri ? `https://api.twilio.com${twData.next_page_uri}` : null;
      pageCount++;
    }
    console.log(`Twilio matching calls: ${twilioCallsCount}, Duration: ${twilioDurationSec} seconds (${(twilioDurationSec / 60).toFixed(2)} minutes)`);
  }

  // 5. Grand Summary
  console.log('\n======================================================');
  console.log('=== GRAND TOTAL CALLING SUMMARY FOR RED ROSE CITY ===');
  console.log('======================================================');
  
  // Total unique Vobiz calls:
  const allVobizCalls = [...subCalls, ...uniqueMasterCalls];
  let grandTotalSec = 0;
  let grandConnectedCalls = 0;
  let grandTotalCalls = allVobizCalls.length + twilioCallsCount;

  allVobizCalls.forEach(c => {
    grandTotalSec += (Number(c.bill_duration) || 0);
    if (c.answer_time) grandConnectedCalls++;
  });
  grandTotalSec += twilioDurationSec;

  const totalMinutes = grandTotalSec / 60;
  const minsPart = Math.floor(grandTotalSec / 60);
  const secsPart = Math.round(grandTotalSec % 60);

  console.log(`Total Calls Initiated: ${grandTotalCalls}`);
  console.log(`Total Calls Answered / Connected: ${grandConnectedCalls}`);
  console.log(`Total Billed Duration: ${grandTotalSec} seconds`);
  console.log(`Total Calling Time: ${totalMinutes.toFixed(2)} minutes (${minsPart} minutes ${secsPart} seconds)`);
  console.log('======================================================');

  // Let's print table of top calls by duration
  detailedSubCalls.sort((a, b) => b.bill_duration_sec - a.bill_duration_sec);
  console.log('\nTop 15 longest calls:');
  detailedSubCalls.slice(0, 15).forEach((c, idx) => {
    console.log(`${idx + 1}. To: ${c.to_number} | Duration: ${c.bill_duration_sec}s (${c.bill_duration_min} min) | Cost: ${c.cost} ${c.currency} | Cause: ${c.hangup_cause} | Date: ${c.initiation_time}`);
  });
}

fullAudit().catch(console.error);
