import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function reset131042Recipients() {
    const broadcastId = '07b6ef99-6f24-4309-a251-48fee7e29d2e';

    console.log(`Checking recipients for broadcast ${broadcastId}...`);

    const { count: paymentFailCount } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('*', { count: 'exact', head: true })
        .eq('broadcast_id', broadcastId)
        .eq('status', 'failed')
        .ilike('error_message', '%131042%');

    console.log(`Found ${paymentFailCount} recipients with Error 131042 (Business eligibility payment issue).`);

    // Reset them to pending
    const { data, error } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .update({
            status: 'pending',
            error_message: null,
            sent_at: null
        })
        .eq('broadcast_id', broadcastId)
        .eq('status', 'failed')
        .ilike('error_message', '%131042%');

    if (error) {
        console.error('Update error:', error);
    } else {
        console.log(`Successfully reset ${paymentFailCount} recipients to 'pending'!`);
    }

    // Also check total pending now
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

    console.log(`Updated Broadcast Totals:`, {
        sent: sentCount,
        pending: pendingCount,
        failed: failedCount
    });
}

reset131042Recipients().catch(console.error);
