import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function inspectBookingsAndInterests() {
    const userId = 'c3893924-5a57-4da3-b4bc-7c70d8ee7c59';

    // 1. Get profile preferences
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
    console.log("=== ADMIN PROFILE & CONTACT INFO ===");
    console.log({
        email: profile.email,
        business_name: profile.business_name,
        contact_number: profile.contact_number,
        whatsapp_personal_number: profile.whatsapp_personal_number,
        notification_preferences: profile.notification_preferences
    });

    // 2. The 8 Bookings
    const { data: bookedLeads } = await supabase
        .from('leads')
        .select('*')
        .eq('user_id', userId)
        .or('pipeline_stage.ilike.%appoint%,pipeline_stage.ilike.%visit%,booked_time.not.is.null')
        .order('created_at', { ascending: false });

    console.log(`\n=== BOOKED LEADS (${bookedLeads?.length}) ===`);
    for (const l of bookedLeads || []) {
        console.log(`\nLead: ${l.name} | Phone: ${l.phone} | ID: ${l.id}`);
        console.log(`  Stage: ${l.pipeline_stage} | Status: ${l.status}`);
        console.log(`  Booked Time: ${l.booked_time}`);
        console.log(`  Voice Call Status: ${l.voice_call_status}`);
        console.log(`  Source: ${l.source}`);
        console.log(`  Summary: ${l.voice_call_summary}`);

        // Check notifications for this lead
        const { data: notifs } = await supabase
            .from('notifications')
            .select('*')
            .eq('user_id', userId)
            .ilike('action_link', `%${l.id}%`);
        console.log(`  In-app Notifications count: ${notifs?.length}`);
        notifs?.forEach(n => console.log(`    - [${n.created_at}] [${n.type}] ${n.title}`));
    }

    // 3. Inspect high interest alerts
    console.log(`\n=== HIGH INTEREST NOTIFICATIONS ===`);
    const { data: interestNotifs } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .eq('type', 'lead_interested')
        .order('created_at', { ascending: false });

    console.log(`Total lead_interested notifications: ${interestNotifs?.length}`);
    for (const n of interestNotifs || []) {
        console.log(`\n- [${n.created_at}] ${n.title}`);
        console.log(`  Link: ${n.action_link}`);
        console.log(`  Snippet: ${n.message?.slice(0, 200)}...`);
    }

    // 4. Inspect expert connection requests
    console.log(`\n=== EXPERT CONNECTION NOTIFICATIONS ===`);
    const { data: expertNotifs } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .eq('type', 'connect_expert')
        .order('created_at', { ascending: false });
    console.log(`Total connect_expert notifications: ${expertNotifs?.length}`);
}

inspectBookingsAndInterests().catch(console.error);
