const fs = require('fs');
const path = require('path');

const vobizStatusPath = path.join(__dirname, '..', 'app', 'api', 'voice', 'vobiz', 'status-callback', 'route.ts');
let vobizStatus = fs.readFileSync(vobizStatusPath, 'utf8');

// Replace using regex that ignores line endings
const targetRegex = /const updatePayload:\s*any\s*=\s*\{\}[\r\n\s]+if\s*\(updatedStatus\)\s*\{\s*updatePayload\.voice_call_status\s*=\s*updatedStatus\s*\}/;

const replacement = `const updatePayload: any = {}
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

if (targetRegex.test(vobizStatus)) {
  vobizStatus = vobizStatus.replace(targetRegex, replacement);
  fs.writeFileSync(vobizStatusPath, vobizStatus, 'utf8');
  console.log('✅ Successfully updated app/api/voice/vobiz/status-callback/route.ts with automated follow-up retry scheduling!');
} else {
  console.error('❌ Could not find target snippet in vobiz/status-callback/route.ts');
}
