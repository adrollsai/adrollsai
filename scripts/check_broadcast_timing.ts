import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkPendingBroadcast() {
    const broadcastId = 'aa6efe5d-ae5d-488f-9b7f-05f7fbde3bbe';

    const { data: sentRecs } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('id, phone_number, status, sent_at, error_message')
        .eq('broadcast_id', broadcastId)
        .eq('status', 'sent')
        .order('sent_at', { ascending: true });

    console.log(`First sent message:`, sentRecs?.[0]);
    console.log(`Last sent message:`, sentRecs?.[sentRecs.length - 1]);
    console.log(`Total sent:`, sentRecs?.length);

    if (sentRecs && sentRecs.length > 0) {
        const first = new Date(sentRecs[0].sent_at!).getTime();
        const last = new Date(sentRecs[sentRecs.length - 1].sent_at!).getTime();
        console.log(`Time taken for 97 messages: ${(last - first) / 1000} seconds`);
    }

    // Check pending
    const { data: pendingRecs } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('id, phone_number, status, sent_at, error_message')
        .eq('broadcast_id', broadcastId)
        .eq('status', 'pending');

    console.log(`Pending count:`, pendingRecs?.length);
    console.log(`Sample pending:`, pendingRecs?.slice(0, 5));
}

checkPendingBroadcast().catch(console.error);
