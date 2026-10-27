const fs = require('fs');
const path = require('path');

console.log('--- Applying Follow-up Scheduling & Fresh Section Rules ---');

// 1. UPDATE app/api/voice/post-call-notify/route.ts
const postNotifyPath = path.join(__dirname, '..', 'app', 'api', 'voice', 'post-call-notify', 'route.ts');
let postNotifyCode = fs.readFileSync(postNotifyPath, 'utf8');

// Ensure assigned_to is selected
if (!postNotifyCode.includes('assigned_to')) {
  postNotifyCode = postNotifyCode.replace(
    ".select('id, name, phone, email, pipeline_stage, status, custom_fields, user_id, budget, source, ad_name, campaign_id, voice_campaign_id, notes, summary, voice_call_summary')",
    ".select('id, name, phone, email, pipeline_stage, status, custom_fields, user_id, budget, source, ad_name, campaign_id, voice_campaign_id, notes, summary, voice_call_summary, assigned_to')"
  );
}

// Update Case 1 to notify assigned agent as well
if (!postNotifyCode.includes('Sent Appointment Booked alert to assigned agent')) {
  const case1AdminLog = "console.log(`[POST-CALL NOTIFY] Sent Appointment Booked admin alert for lead ${leadId}`)";
  const case1WithAgent = `// Also notify assigned agent if lead is assigned to someone other than owner
      if (lead.assigned_to && lead.assigned_to !== ownerUserId) {
        try {
          await sendAdminMultiChannelNotification({
            ownerUserId: lead.assigned_to,
            title: \`🎙️ Site Visit / Appointment Booked: \${leadName}\`,
            body: \`AI Voice Agent successfully scheduled an on-site visit/appointment for your assigned lead \${leadName}!\\n\\n📅 Date & Time: \${formattedSlotDate} (IST)\\n👤 Lead: \${leadName}\\n📞 Phone: \${leadPhone}\\n🏢 Project / Property: \${propertyLabel}\\n📢 Source: \${leadSource} (\${campaignName})\\n💰 Budget: \${budgetVal}\${formattedAnswersStr ? \`\\n\\n📋 Answers:\\n\${formattedAnswersStr}\\n\` : ''}\\n📝 Call Summary: \${summary}\`,
            url: \`/dashboard/crm/\${leadId}\`,
            type: 'meeting_booked',
            leadPhone,
            leadName,
            leadId,
            emailSubject: \`🎙️ Site Visit / Appointment Booked for Assigned Lead: \${leadName} (\${propertyLabel})\`
          })
          console.log(\`[POST-CALL NOTIFY] Sent Appointment Booked alert to assigned agent \${lead.assigned_to}\`)
        } catch (agentErr: any) {
          console.warn(\`[POST-CALL NOTIFY] Error notifying assigned agent \${lead.assigned_to}:\`, agentErr.message)
        }
      }

      console.log(\`[POST-CALL NOTIFY] Sent Appointment Booked admin alert for lead \${leadId}\`)`;
  postNotifyCode = postNotifyCode.replace(case1AdminLog, case1WithAgent);
}

// Update Case 2 so leads stay in Fresh and non-appointments don't send alerts
const case2Regex = /\/\/ CASE 2: Prospect showed genuine interest[\s\S]*?return NextResponse\.json\(\{\s*success: true,\s*action: 'interest_notified'[\s\S]*?\}\)/;
if (case2Regex.test(postNotifyCode)) {
  const newCase2 = `// CASE 2: No appointment booked.
    // RULE: Keep lead in Fresh section so human tele-callers can get to them.
    // Only appointments trigger external notifications to admin & assigned agents.
    console.log(\`[POST-CALL NOTIFY] Call completed for lead \${leadId} without appointment booking. Kept in Fresh section for tele-callers. No alert dispatched.\`);
    return NextResponse.json({
      success: true,
      action: 'fresh_retained_no_alert',
      leadId
    });`;
  postNotifyCode = postNotifyCode.replace(case2Regex, newCase2);
}

fs.writeFileSync(postNotifyPath, postNotifyCode, 'utf8');
console.log('✅ Updated app/api/voice/post-call-notify/route.ts');


// 2. UPDATE voice-bridge/server.js
const serverJsPath = path.join(__dirname, '..', 'voice-bridge', 'server.js');
let serverJs = fs.readFileSync(serverJsPath, 'utf8');

// Ensure computeValidCallingSlot is imported/available in server.js
// Check if computeValidCallingSlot exists in server.js
if (!serverJs.includes('computeValidCallingSlot')) {
  console.log('computeValidCallingSlot not in server.js, adding definition...');
  const helperCode = `
function computeValidCallingSlot(targetDate = new Date(), timeZone = 'Asia/Kolkata') {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        hour: 'numeric',
        minute: 'numeric'
    });
    const [hStr, mStr] = formatter.format(targetDate).split(':');
    const hourVal = parseInt(hStr, 10);
    const minuteVal = parseInt(mStr, 10);
    const timeInMinutes = hourVal * 60 + minuteVal;
    const startMinutes = 9 * 60 + 30; // 09:30 AM
    const endMinutes = 18 * 60 + 30;  // 06:30 PM

    if (timeInMinutes >= startMinutes && timeInMinutes < endMinutes) {
        return { isWithinWindow: true, scheduledTime: targetDate };
    }

    // Schedule for next business day at 10:00 AM
    const nextDay = new Date(targetDate);
    if (timeInMinutes >= endMinutes) {
        nextDay.setDate(nextDay.getDate() + 1);
    }
    const dateParts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric'
    }).formatToParts(nextDay);
    const y = dateParts.find(p => p.type === 'year').value;
    const m = String(dateParts.find(p => p.type === 'month').value).padStart(2, '0');
    const d = String(dateParts.find(p => p.type === 'day').value).padStart(2, '0');
    const nextSlotIso = \`\${y}-\${m}-\${d}T10:00:00+05:30\`;
    return { isWithinWindow: false, scheduledTime: new Date(nextSlotIso) };
}
`;
  serverJs = helperCode + '\n' + serverJs;
}

// Replace stage updates in voice-bridge/server.js so leads remain in Fresh unless isValidBooking
const oldBridgeStageLogic = `                if (!isValidBooking) {
                    if (isQualified && isInterested) {
                        updatePayload.status = 'Qualified';
                        updatePayload.pipeline_stage = 'Qualified';
                    } else if (isInterested) {
                        updatePayload.status = 'Contacted';
                        updatePayload.pipeline_stage = 'Contacted';
                    } else {
                        if (!lead || !lead.pipeline_stage || lead.pipeline_stage === 'New Lead' || lead.pipeline_stage === 'New' || lead.status === 'New Lead' || lead.status === 'New') {
                            updatePayload.status = 'Contacted';
                            updatePayload.pipeline_stage = 'Contacted';
                        }
                    }
                }`;

const newBridgeStageLogic = `                if (!isValidBooking) {
                    // CRITICAL RULE: Keep lead in Fresh section so human tele-callers can get to them!
                    // Do NOT transition lead stage to Contacted / Qualified unless an actual appointment is booked.
                    if (!lead || !lead.pipeline_stage || lead.pipeline_stage === 'New Lead' || lead.pipeline_stage === 'New' || lead.status === 'New Lead' || lead.status === 'New') {
                        updatePayload.status = 'New Lead';
                        updatePayload.pipeline_stage = 'New Lead';
                    }

                    // Check if lead was uncommunicative (prospect didn't speak or hung up with 0 user responses)
                    const userMessages = (transcript || []).filter(t => t.role === 'user' && t.message && t.message.trim().length > 0);
                    const hasUserSpoken = userMessages.length > 0;

                    if (!hasUserSpoken && !callbackTime) {
                        const currentRetries = lead?.voice_call_retry_count || 0;
                        if (currentRetries < 3) {
                            const nextRetryCount = currentRetries + 1;
                            let delayMinutes = 30;
                            if (nextRetryCount === 2) delayMinutes = 90;
                            if (nextRetryCount === 3) delayMinutes = 180;

                            const targetRawDate = new Date(Date.now() + delayMinutes * 60000);
                            const { scheduledTime: validSlot } = computeValidCallingSlot(targetRawDate, 'Asia/Kolkata');
                            updatePayload.voice_call_status = 'scheduled_retry';
                            updatePayload.voice_call_scheduled_at = validSlot.toISOString();
                            updatePayload.voice_call_retry_count = nextRetryCount;
                            console.log(\`[BRIDGE] Uncommunicative lead \${leadId} (0 user messages): scheduled follow-up retry #\${nextRetryCount} for \${validSlot.toISOString()}\`);
                        }
                    }
                }`;

if (serverJs.includes(oldBridgeStageLogic)) {
  serverJs = serverJs.replace(oldBridgeStageLogic, newBridgeStageLogic);
  console.log('✅ Replaced voice-bridge stage updates with Fresh section retention & uncommunicative retry scheduling');
}

fs.writeFileSync(serverJsPath, serverJs, 'utf8');
console.log('✅ Updated voice-bridge/server.js');


// 3. UPDATE app/api/voice/vobiz/status-callback/route.ts
const vobizStatusPath = path.join(__dirname, '..', 'app', 'api', 'voice', 'vobiz', 'status-callback', 'route.ts');
let vobizStatus = fs.readFileSync(vobizStatusPath, 'utf8');

// Check if retry scheduling logic already exists
if (!vobizStatus.includes('scheduled_retry')) {
  const targetSnippet = `            const updatePayload: any = {}
            if (updatedStatus) {
                updatePayload.voice_call_status = updatedStatus
            }`;

  const replacementSnippet = `            const updatePayload: any = {}
            if (updatedStatus) {
                updatePayload.voice_call_status = updatedStatus
            }

            // Automated follow-up retry scheduling for unanswered / busy / failed calls
            if (['no_answer', 'failed'].includes(updatedStatus || '')) {
                try {
                    const { data: currentLead } = await supabaseAdmin
                        .from('leads')
                        .select('id, voice_call_retry_count, pipeline_stage, status, notes')
                        .eq('id', leadId)
                        .single()

                    const currentRetries = currentLead?.voice_call_retry_count || 0
                    if (currentRetries < 3) {
                        const nextRetryCount = currentRetries + 1
                        let delayMinutes = 30
                        if (nextRetryCount === 2) delayMinutes = 90
                        if (nextRetryCount === 3) delayMinutes = 180

                        const { computeValidCallingSlot } = await import('@/utils/calling-window')
                        const targetRawDate = new Date(Date.now() + delayMinutes * 60000)
                        const { scheduledTime: validSlot } = computeValidCallingSlot(targetRawDate, 'Asia/Kolkata')
                        const scheduledTime = validSlot.toISOString()

                        updatePayload.voice_call_status = 'scheduled_retry'
                        updatePayload.voice_call_scheduled_at = scheduledTime
                        updatePayload.voice_call_retry_count = nextRetryCount

                        // CRITICAL: Keep lead in Fresh section so human tele-callers can get to them!
                        if (!currentLead?.pipeline_stage || currentLead.pipeline_stage === 'New' || currentLead.pipeline_stage === 'New Lead') {
                            updatePayload.pipeline_stage = 'New Lead'
                            updatePayload.status = 'New Lead'
                        }

                        let updatedNotes = \`[⚠️ Call Rescheduled]: Follow-up retry #\${nextRetryCount} scheduled for \${validSlot.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} (Reason: \${callStatus})\`
                        if (currentLead?.notes) {
                            updatedNotes += \`\\n\\n\${currentLead.notes}\`
                        }
                        updatePayload.notes = updatedNotes

                        await supabaseAdmin
                            .from('lead_history')
                            .insert({
                                lead_id: leadId,
                                action_type: 'REMARK',
                                description: \`⚠️ Outbound call was unanswered/busy (\${callStatus}). Scheduled automated retry #\${nextRetryCount} at \${validSlot.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}.\`
                            })
                        console.log(\`[VOBIZ STATUS] Scheduled follow-up retry #\${nextRetryCount} for lead \${leadId} at \${scheduledTime}\`)
                    } else {
                        updatePayload.voice_call_status = 'no_answer'
                        updatePayload.voice_call_scheduled_at = null
                        if (!currentLead?.pipeline_stage || currentLead.pipeline_stage === 'New' || currentLead.pipeline_stage === 'New Lead') {
                            updatePayload.pipeline_stage = 'New Lead'
                            updatePayload.status = 'New Lead'
                        }
                    }
                } catch (retryErr: any) {
                    console.warn('[VOBIZ STATUS] Error scheduling follow-up retry:', retryErr.message)
                }
            }`;

  vobizStatus = vobizStatus.replace(targetSnippet, replacementSnippet);
  fs.writeFileSync(vobizStatusPath, vobizStatus, 'utf8');
  console.log('✅ Updated app/api/voice/vobiz/status-callback/route.ts with automated follow-up retry scheduling');
}

console.log('--- All rules applied successfully ---');
