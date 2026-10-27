const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function analyzeUmangCalls() {
    const userId = 'b685d287-7d54-4c9c-ae03-a46bb96ebdde'; // Umang Associates

    const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

    console.log(`================================================================`);
    console.log(`ACCOUNT: ${profile?.business_name || 'Umang Associates'} (${profile?.email})`);
    console.log(`User ID: ${userId}`);
    console.log(`Total Credits: ${profile?.credits}`);
    console.log(`================================================================`);

    // 1. Fetch all leads
    const { data: leads, error } = await supabase
        .from('leads')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (error || !leads) {
        console.error("Error fetching leads:", error);
        return;
    }

    console.log(`Total Leads in CRM: ${leads.length}`);

    // Call status breakdown
    const statusMap = {};
    for (const l of leads) {
        const s = l.voice_call_status || (l.voice_call_id ? 'status_null_has_call_id' : 'never_called');
        statusMap[s] = (statusMap[s] || 0) + 1;
    }
    console.log("\n--- Voice Call Status Breakdown ---");
    console.log(JSON.stringify(statusMap, null, 2));

    // 2. Identify all leads where an AI call was attempted / initiated
    const callAttemptedLeads = leads.filter(l => {
        if (l.voice_call_status === 'skipped_international' || l.voice_call_status === 'qualified_via_whatsapp') {
            return Boolean(l.voice_call_id || l.voice_recording_url || l.voice_call_summary);
        }
        return Boolean(
            (l.voice_call_status && l.voice_call_status !== 'never_called' && l.voice_call_status !== 'not_called') ||
            l.voice_call_id ||
            l.voice_recording_url ||
            l.voice_call_summary
        );
    });

    console.log(`\n================================================================`);
    console.log(`TOTAL AI CALLS MADE / ATTEMPTED: ${callAttemptedLeads.length}`);
    console.log(`================================================================`);

    // Breakdown of attempted calls
    let connectedCount = 0;
    let noAnswerCount = 0;
    let callingOrPendingCount = 0;
    let failedOrOtherCount = 0;

    const connectedLeads = [];
    const nonConnectedLeads = [];

    for (const l of callAttemptedLeads) {
        let tr = l.voice_call_transcript;
        if (typeof tr === 'string') {
            try { tr = JSON.parse(tr); } catch(e) {}
        }
        const hasTranscript = Array.isArray(tr) && tr.length > 0;
        const hasSummary = Boolean(l.voice_call_summary);
        const hasRecording = Boolean(l.voice_recording_url);

        const isConnected = l.voice_call_status === 'completed' || hasTranscript || hasSummary || hasRecording;

        if (isConnected) {
            connectedCount++;
            connectedLeads.push({
                ...l,
                transcriptParsed: tr,
                turnsCount: Array.isArray(tr) ? tr.length : 0
            });
        } else if (l.voice_call_status === 'no_answer') {
            noAnswerCount++;
            nonConnectedLeads.push(l);
        } else if (l.voice_call_status === 'calling') {
            callingOrPendingCount++;
            nonConnectedLeads.push(l);
        } else {
            failedOrOtherCount++;
            nonConnectedLeads.push(l);
        }
    }

    console.log(`\n--- CALL OUTCOME SUMMARY ---`);
    console.log(`1. Total AI Calls Made / Initiated: ${callAttemptedLeads.length}`);
    console.log(`2. Total Calls Connected (Answered): ${connectedCount}`);
    console.log(`   - Connected & Completed: ${connectedLeads.filter(l => l.voice_call_status === 'completed').length}`);
    console.log(`   - Connected with Summary/Transcript: ${connectedLeads.filter(l => l.voice_call_status !== 'completed').length}`);
    console.log(`3. Total Calls Not Connected / Unanswered: ${callAttemptedLeads.length - connectedCount}`);
    console.log(`   - No Answer: ${noAnswerCount}`);
    console.log(`   - Currently Calling / In-progress: ${callingOrPendingCount}`);
    console.log(`   - Other: ${failedOrOtherCount}`);

    let engagedCount = 0;
    let oneSidedGreetingOnly = 0;

    for (const c of connectedLeads) {
        const tr = c.transcriptParsed;
        const userSpoke = Array.isArray(tr) && tr.some((t) => t.role === 'user' || t.speaker === 'user');
        if (userSpoke) {
            engagedCount++;
        } else {
            oneSidedGreetingOnly++;
        }
    }

    console.log(`\n--- ENGAGEMENT BREAKDOWN OF CONNECTED CALLS ---`);
    console.log(`- Active 2-Way Conversations (prospect spoke & replied): ${engagedCount}`);
    console.log(`- 1-Way (Picked up / answered but hung up / prospect didn't respond to greeting): ${oneSidedGreetingOnly}`);

    // 3. BOOKINGS / APPOINTMENTS ANALYSIS
    console.log(`\n================================================================`);
    console.log(`BOOKING / APPOINTMENT ANALYSIS`);
    console.log(`================================================================`);

    const leadsWithBookedTime = leads.filter(l => Boolean(l.booked_time));
    console.log(`Leads with confirmed 'booked_time' timestamp: ${leadsWithBookedTime.length}`);
    for (const b of leadsWithBookedTime) {
        console.log(`\nCONFIRMED BOOKING RECORD:`);
        console.log(`- Lead Name: ${b.name}`);
        console.log(`- Phone: ${b.phone}`);
        console.log(`- Booked Time: ${b.booked_time}`);
        console.log(`- Pipeline Stage: ${b.pipeline_stage}`);
        console.log(`- CRM Status: ${b.status}`);
        console.log(`- Voice Call Status: ${b.voice_call_status}`);
        console.log(`- Voice Recording: ${b.voice_recording_url || 'None'}`);
        console.log(`- Summary: ${b.voice_call_summary || 'None'}`);
        console.log(`- Google Calendar Event ID: ${b.google_calendar_event_id || 'None'}`);
    }

    const appointmentBookedStageLeads = leads.filter(l => (l.pipeline_stage || '').toLowerCase().includes('appointment booked'));
    console.log(`\nLeads in 'Appointment Booked' pipeline stage: ${appointmentBookedStageLeads.length}`);

    const visitPlannedStageLeads = leads.filter(l => (l.pipeline_stage || '').toLowerCase().includes('visit planned'));
    console.log(`Leads in 'Visit Planned' pipeline stage: ${visitPlannedStageLeads.length}`);
    for (const vp of visitPlannedStageLeads) {
        console.log(`   - ${vp.name} (${vp.phone}) | Call Status: ${vp.voice_call_status || 'None'} | Booked Time: ${vp.booked_time || 'None'}`);
        if (vp.voice_call_summary) {
            console.log(`     Summary: ${vp.voice_call_summary}`);
        }
    }

    // 4. Notifications
    const { data: notifs } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    console.log(`\n================================================================`);
    console.log(`NOTIFICATIONS (${notifs?.length || 0} total)`);
    console.log(`================================================================`);
    const bookingNotifs = (notifs || []).filter(n => /book|appoint|visit/i.test(n.title) || /book|appoint|visit/i.test(n.message));
    console.log(`Booking/Appointment Notifications: ${bookingNotifs.length}`);
    for (const bn of bookingNotifs) {
        console.log(`- [${bn.created_at}] [${bn.type}] ${bn.title}: ${bn.message}`);
    }

    // 5. List all 2-way connected calls for complete transparency
    console.log(`\n================================================================`);
    console.log(`DETAILED SUMMARY OF ALL CONNECTED CALLS (${connectedLeads.length})`);
    console.log(`================================================================`);
    connectedLeads.forEach((c, idx) => {
        let tr = c.transcriptParsed;
        const userTurns = Array.isArray(tr) ? tr.filter(t => t.role === 'user' || t.speaker === 'user') : [];
        console.log(`\n[${idx + 1}] Lead: ${c.name} (${c.phone})`);
        console.log(`    Status: ${c.voice_call_status} | Stage: ${c.pipeline_stage} | Booked Time: ${c.booked_time || 'None'}`);
        console.log(`    Summary: ${c.voice_call_summary || 'No summary generated'}`);
        console.log(`    User Spoke: ${userTurns.length > 0 ? 'YES (' + userTurns.length + ' responses)' : 'NO (only agent greeting)'}`);
        console.log(`    Recording: ${c.voice_recording_url ? 'Available' : 'None'}`);
    });
}

analyzeUmangCalls().catch(console.error);
