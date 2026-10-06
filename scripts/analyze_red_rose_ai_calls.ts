import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function analyze() {
    const userId = 'c3893924-5a57-4da3-b4bc-7c70d8ee7c59';

    // 1. Get all leads for this user
    const { data: leads, error } = await supabase
        .from('leads')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Error fetching leads:", error);
        return;
    }

    console.log(`=== RED ROSE CITY ACCOUNT (User: ${userId}) ===`);
    console.log(`Total Leads in CRM: ${leads.length}`);

    // Call status breakdown
    const statusMap: Record<string, number> = {};
    for (const l of leads) {
        const s = l.voice_call_status || 'never_called';
        statusMap[s] = (statusMap[s] || 0) + 1;
    }
    console.log("\n--- Voice Call Status Breakdown ---");
    console.log(JSON.stringify(statusMap, null, 2));

    // Leads where a call was actually initiated or completed
    const calledLeads = leads.filter(l => 
        l.voice_call_status && 
        l.voice_call_status !== 'never_called' && 
        l.voice_call_status !== 'not_called'
    );
    console.log(`\nTotal Leads with AI Call Attempted/Triggered: ${calledLeads.length}`);

    // Leads where call connected/answered (has transcript or summary or completed)
    const connectedLeads = leads.filter(l => {
        let tr = l.voice_call_transcript;
        if (typeof tr === 'string') {
            try { tr = JSON.parse(tr); } catch(e) {}
        }
        const hasTranscript = Array.isArray(tr) && tr.length > 0;
        const hasSummary = Boolean(l.voice_call_summary);
        return hasTranscript || hasSummary || l.voice_call_status === 'completed';
    });
    console.log(`Leads with Actual Connected/Answered Calls (transcript or summary): ${connectedLeads.length}`);

    // Analyze each connected call:
    console.log("\n=== DETAILS OF CONNECTED / ANSWERED CALLS ===");
    for (const l of connectedLeads) {
        let cf = l.custom_fields;
        if (typeof cf === 'string') {
            try { cf = JSON.parse(cf); } catch(e) {}
        }
        let tr = l.voice_call_transcript;
        if (typeof tr === 'string') {
            try { tr = JSON.parse(tr); } catch(e) {}
        }

        console.log(`\n--------------------------------------------------`);
        console.log(`Lead: ${l.name} | Phone: ${l.phone}`);
        console.log(`Call Status: ${l.voice_call_status} | Stage: ${l.pipeline_stage} | CRM Status: ${l.status}`);
        console.log(`Booked Time: ${l.booked_time || 'None'}`);
        console.log(`Voice Summary: ${l.voice_call_summary || 'None'}`);
        console.log(`Custom Fields (Qualification):`, {
            is_qualified: cf?.is_qualified,
            is_interested: cf?.is_interested,
            lead_priority: cf?.lead_priority,
            budget: cf?.budget || l.budget,
            requirement: cf?.requirement,
            timeline: cf?.timeline
        });
        console.log(`Transcript Turn Count: ${Array.isArray(tr) ? tr.length : 0}`);
        if (Array.isArray(tr) && tr.length > 0) {
            console.log(`Transcript excerpt:`);
            tr.forEach((t: any, i: number) => {
                console.log(`   [${t.role || 'speaker'}]: ${t.message || t.text}`);
            });
        }
    }

    // Bookings across all leads
    console.log("\n=== BOOKINGS / APPOINTMENTS ANALYSIS ===");
    const bookedLeads = leads.filter(l => 
        Boolean(l.booked_time) || 
        (l.pipeline_stage && /appoint|visit|meet/i.test(l.pipeline_stage)) ||
        (l.status && /appoint|visit|meet/i.test(l.status))
    );
    console.log(`Total Booked / Appointment Leads: ${bookedLeads.length}`);
    for (const b of bookedLeads) {
        console.log(`- ${b.name} (${b.phone}) | Stage: ${b.pipeline_stage} | Booked Time: ${b.booked_time} | Call Status: ${b.voice_call_status}`);
    }

    // Interested leads across all leads
    console.log("\n=== INTERESTED / QUALIFIED LEADS ANALYSIS ===");
    const interestedLeads = leads.filter(l => {
        let cf = l.custom_fields;
        if (typeof cf === 'string') {
            try { cf = JSON.parse(cf); } catch(e) {}
        }
        const stage = (l.pipeline_stage || '').toLowerCase();
        const status = (l.status || '').toLowerCase();
        return stage.includes('interest') || 
               status.includes('interest') || 
               cf?.is_interested === true || 
               cf?.is_qualified === true ||
               cf?.lead_priority === 'HOT' ||
               cf?.lead_priority === 'WARM';
    });
    console.log(`Total Interested / Qualified Leads: ${interestedLeads.length}`);
    for (const il of interestedLeads) {
        let cf = il.custom_fields;
        if (typeof cf === 'string') {
            try { cf = JSON.parse(cf); } catch(e) {}
        }
        console.log(`- ${il.name} (${il.phone}) | Stage: ${il.pipeline_stage} | Status: ${il.status} | Call Status: ${il.voice_call_status} | Priority: ${cf?.lead_priority} | Interested: ${cf?.is_interested}`);
    }

    // Notifications check
    console.log("\n=== ADMIN NOTIFICATIONS CHECK ===");
    const { data: notifs } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    console.log(`Total In-App Notifications in DB: ${notifs?.length || 0}`);
    const notifsByType: Record<string, number> = {};
    for (const n of notifs || []) {
        notifsByType[n.type] = (notifsByType[n.type] || 0) + 1;
    }
    console.log("Notifications by Type:", notifsByType);

    // Filter voice call or booking related notifications
    const voiceOrBookingNotifs = (notifs || []).filter(n => 
        /call|voice|book|appoint|interest|expert|visit/i.test(n.type) ||
        /call|voice|book|appoint|interest|expert|visit/i.test(n.title)
    );
    console.log(`\nVoice / Booking / Interest / Expert Notifications (${voiceOrBookingNotifs.length}):`);
    for (const vn of voiceOrBookingNotifs) {
        console.log(`- [${vn.created_at}] [${vn.type}] ${vn.title}`);
        console.log(`  Message: ${vn.message}`);
        console.log(`  Link: ${vn.action_link}`);
    }
}

analyze().catch(console.error);
