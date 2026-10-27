import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function inspectTimeline() {
    const broadcastId = '07b6ef99-6f24-4309-a251-48fee7e29d2e';

    const { data: recipients } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('id, phone_number, status, sent_at, error_message')
        .eq('broadcast_id', broadcastId)
        .order('sent_at', { ascending: true });

    console.log('Total recipients:', recipients?.length);

    // Look at the sequence of statuses
    let sentCount = 0;
    let failedCount = 0;
    const history: any[] = [];

    for (const r of (recipients || [])) {
        if (r.status === 'sent') {
            sentCount++;
            history.push({ idx: history.length + 1, type: 'SENT', time: r.sent_at, phone: r.phone_number });
        } else if (r.status === 'failed') {
            failedCount++;
            if (failedCount <= 10 || failedCount % 200 === 0 || failedCount >= 920) {
                history.push({ idx: history.length + 1, type: 'FAILED', time: r.sent_at, err: r.error_message, phone: r.phone_number });
            }
        }
    }

    console.log('Sequence history snapshot:');
    console.log(history.slice(0, 30));
    console.log('Later history:');
    console.log(history.slice(-30));
}

inspectTimeline().catch(console.error);
