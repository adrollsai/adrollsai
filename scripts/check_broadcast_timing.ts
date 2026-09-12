import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkPendingBroadcast() {
    const broadcastId = '76c3c2c6-17f2-4c4f-9b07-30432e09d503';

    const { data: sentRecs } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('id, phone_number, status, sent_at, error_message')
        .eq('broadcast_id', broadcastId)
        .eq('status', 'sent')
        .order('sent_at', { ascending: true });

    console.log(`First sent message:`, sentRecs?.[0]);
    console.log(`Last sent message:`, sentRecs?.[sentRecs.length - 1]);
    console.log(`Total sent:`, sentRecs?.length);

    if (sentRecs && sentRecs.length > 1) {
        const first = new Date(sentRecs[0].sent_at!).getTime();
        const last = new Date(sentRecs[sentRecs.length - 1].sent_at!).getTime();
        const totalDurationSec = (last - first) / 1000;
        console.log(`Total duration so far: ${totalDurationSec.toFixed(1)} seconds (${(totalDurationSec/60).toFixed(1)} mins)`);
        console.log(`Average time per message: ${(totalDurationSec / (sentRecs.length - 1)).toFixed(2)} seconds`);

        const diffs = [];
        for (let i = 1; i < sentRecs.length; i++) {
            const tPrev = new Date(sentRecs[i-1].sent_at!).getTime();
            const tCurr = new Date(sentRecs[i].sent_at!).getTime();
            diffs.push(((tCurr - tPrev) / 1000).toFixed(1));
        }
        console.log(`Last 10 intervals (s):`, diffs.slice(-10));
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
