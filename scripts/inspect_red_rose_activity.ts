import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
    const userId = 'c3893924-5a57-4da3-b4bc-7c70d8ee7c59';

    // 1. Profile details
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
    console.log("=== PROFILE ===");
    console.log({
        id: profile?.id,
        email: profile?.email,
        business_name: profile?.business_name,
        role: profile?.role,
        whatsapp_personal_number: profile?.whatsapp_personal_number,
        contact_number: profile?.contact_number,
        whatsapp_phone_number: profile?.whatsapp_phone_number,
        notification_preferences: profile?.notification_preferences,
        business_info: profile?.business_info
    });

    // 2. Check voice campaigns
    const { data: voiceCampaigns } = await supabase.from('voice_campaigns').select('*').eq('user_id', userId);
    console.log("\n=== VOICE CAMPAIGNS ===");
    console.log("Count:", voiceCampaigns?.length);
    voiceCampaigns?.forEach(vc => console.log(`- [${vc.id}] ${vc.name} (Status: ${vc.status})`));

    // 3. Check campaign_jobs
    const { data: campaignJobs } = await supabase.from('campaign_jobs').select('id, name, status, created_at').eq('user_id', userId);
    console.log("\n=== CAMPAIGN JOBS ===");
    console.log(campaignJobs);

    // 4. Check all leads
    const { data: leads, error: leadsErr } = await supabase
        .from('leads')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    console.log("\n=== LEADS SUMMARY ===");
    console.log(`Total leads for account: ${leads?.length || 0}`);

    if (leads) {
        // Group by voice_call_status
        const statusCounts: Record<string, number> = {};
        for (const l of leads) {
            const st = l.voice_call_status || 'not_called';
            statusCounts[st] = (statusCounts[st] || 0) + 1;
        }
        console.log("Voice call statuses:", statusCounts);

        // Group by pipeline_stage
        const stageCounts: Record<string, number> = {};
        for (const l of leads) {
            const st = l.pipeline_stage || 'Unknown';
            stageCounts[st] = (stageCounts[st] || 0) + 1;
        }
        console.log("Pipeline stages:", stageCounts);

        // Find leads with voice call attempts/interactions
        const leadsWithCalls = leads.filter(l => 
            l.voice_call_status && l.voice_call_status !== 'not_called' ||
            (Array.isArray(l.voice_call_transcript) && l.voice_call_transcript.length > 0) ||
            l.voice_call_summary ||
            l.voice_recording_url ||
            l.last_call_at
        );
        console.log(`\nLeads with call attempts / records: ${leadsWithCalls.length}`);

        // Check for bookings / appointments
        const bookingLeads = leads.filter(l => 
            (l.pipeline_stage && l.pipeline_stage.toLowerCase().includes('appoint')) ||
            (l.pipeline_stage && l.pipeline_stage.toLowerCase().includes('visit')) ||
            (l.pipeline_stage && l.pipeline_stage.toLowerCase().includes('book')) ||
            (l.status && l.status.toLowerCase().includes('appoint')) ||
            (l.status && l.status.toLowerCase().includes('book')) ||
            Boolean(l.booked_time)
        );
        console.log(`Leads with bookings / appointments: ${bookingLeads.length}`);

        // Check for interested leads
        const interestedLeads = leads.filter(l => {
            const cf = typeof l.custom_fields === 'string' ? JSON.parse(l.custom_fields) : (l.custom_fields || {});
            const stage = (l.pipeline_stage || '').toLowerCase();
            const status = (l.status || '').toLowerCase();
            return stage.includes('interest') || 
                   status.includes('interest') || 
                   cf.is_interested === true || 
                   cf.is_qualified === true ||
                   cf.lead_priority === 'HOT' ||
                   cf.lead_priority === 'WARM';
        });
        console.log(`Leads with interest / qualification: ${interestedLeads.length}`);

        console.log("\n=== DETAILS OF LEADS WITH CALLS ===");
        for (const l of leadsWithCalls) {
            let cf = l.custom_fields;
            if (typeof cf === 'string') {
                try { cf = JSON.parse(cf); } catch(e) {}
            }
            let tr = l.voice_call_transcript;
            if (typeof tr === 'string') {
                try { tr = JSON.parse(tr); } catch(e) {}
            }
            console.log("--------------------------------------------------");
            console.log(`Lead: ${l.name} | Phone: ${l.phone}`);
            console.log(`Created: ${l.created_at} | Updated: ${l.updated_at}`);
            console.log(`Voice Call Status: ${l.voice_call_status}`);
            console.log(`Stage: ${l.pipeline_stage} | Status: ${l.status}`);
            console.log(`Booked Time: ${l.booked_time}`);
            console.log(`Summary: ${l.voice_call_summary}`);
            console.log(`Custom Fields:`, JSON.stringify(cf));
            console.log(`Transcript turns: ${Array.isArray(tr) ? tr.length : 0}`);
            if (Array.isArray(tr) && tr.length > 0) {
                console.log(`First turn:`, tr[0]);
                console.log(`Last turn:`, tr[tr.length - 1]);
            }
        }
    }

    // 5. Check voice_call_logs table if exists
    try {
        const { data: vlogs, error: vlogsErr } = await supabase
            .from('voice_call_logs')
            .select('*')
            .eq('user_id', userId);
        console.log("\n=== VOICE CALL LOGS (user_id) ===");
        if (vlogsErr) console.log("vlogs error:", vlogsErr.message);
        else console.log(`Count: ${vlogs?.length}`);
    } catch(e: any) {
        console.log("voice_call_logs error:", e.message);
    }

    // 6. Check notifications table
    console.log("\n=== NOTIFICATIONS SENT TO USER/ADMIN ===");
    const { data: notifs, error: notifsErr } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (notifsErr) {
        console.log("Notifications error:", notifsErr.message);
    } else {
        console.log(`Total notifications in database for Red Rose City account: ${notifs?.length}`);
        notifs?.forEach(n => {
            console.log(`- [${n.created_at}] [${n.type}] ${n.title} (Read: ${n.is_read})`);
            console.log(`  Message: ${n.message?.slice(0, 150)}...`);
            console.log(`  Action Link: ${n.action_link}`);
        });
    }

    // 7. Check if there are notifications for any other user or superadmin related to this account or leads
    const leadIds = (leads || []).map(l => l.id);
    if (leadIds.length > 0) {
        const { data: leadNotifs } = await supabase
            .from('notifications')
            .select('*')
            .in('action_link', leadIds.map(id => `/dashboard/crm/${id}`));
        console.log(`\nNotifications matching lead links: ${leadNotifs?.length || 0}`);
        leadNotifs?.forEach(n => {
            console.log(`- Target User: ${n.user_id} | [${n.created_at}] [${n.type}] ${n.title}`);
        });
    }
}

main().catch(console.error);
