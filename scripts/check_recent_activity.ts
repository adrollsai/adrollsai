import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkRecentActivity() {
    // 1. Any broadcast created in the last 24 hours across ALL users?
    const { data: allB } = await supabaseAdmin
        .from('whatsapp_broadcasts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);
    console.log('--- ALL RECENT BROADCASTS ---');
    console.log(allB);

    // 2. Any messages sent in the last 2 hours?
    const { data: recentMsgs } = await supabaseAdmin
        .from('whatsapp_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);
    console.log('\n--- RECENT MESSAGES ---');
    console.log(recentMsgs);

    // 3. Any broadcast recipients updated recently?
    const { data: recentRecs } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('*')
        .order('sent_at', { ascending: false, nullsFirst: false })
        .limit(5);
    console.log('\n--- RECENTLY SENT RECIPIENTS ---');
    console.log(recentRecs);
}

checkRecentActivity().catch(console.error);
