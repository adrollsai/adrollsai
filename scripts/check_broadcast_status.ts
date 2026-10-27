import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
    const broadcastId = '07b6ef99-6f24-4309-a251-48fee7e29d2e';
    await supabaseAdmin
        .from('whatsapp_broadcasts')
        .update({ status: 'paused' })
        .eq('id', broadcastId);

    const { data: targetB } = await supabaseAdmin
        .from('whatsapp_broadcasts')
        .select('*')
        .eq('id', broadcastId)
        .single();
    console.log('Target Broadcast:', targetB);

    const { count: pendingCount } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('*', { count: 'exact', head: true })
        .eq('broadcast_id', broadcastId)
        .eq('status', 'pending');

    const { count: sentCount } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('*', { count: 'exact', head: true })
        .eq('broadcast_id', broadcastId)
        .eq('status', 'sent');

    const { count: failedCount } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('*', { count: 'exact', head: true })
        .eq('broadcast_id', broadcastId)
        .eq('status', 'failed');

    console.log(`Recipients breakdown: Pending: ${pendingCount}, Sent: ${sentCount}, Failed: ${failedCount}`);

    const { count: count131042 } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('*', { count: 'exact', head: true })
        .eq('broadcast_id', broadcastId)
        .ilike('error_message', '%131042%');

    const { data: sample131042 } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('id, error_message, sent_at')
        .eq('broadcast_id', broadcastId)
        .ilike('error_message', '%131042%')
        .limit(5);
    console.log('Sample 131042 records:', sample131042);
}

check().catch(console.error);
