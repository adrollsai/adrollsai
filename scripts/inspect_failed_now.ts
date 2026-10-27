import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function inspectFailed() {
    const broadcastId = '07b6ef99-6f24-4309-a251-48fee7e29d2e';

    const { data: sampleFailed } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('id, phone_number, status, error_message, sent_at')
        .eq('broadcast_id', broadcastId)
        .eq('status', 'failed')
        .order('sent_at', { ascending: false })
        .limit(20);

    console.log('Sample failed rows:', sampleFailed);

    const { data: sampleSent } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('id, phone_number, status, error_message, sent_at')
        .eq('broadcast_id', broadcastId)
        .eq('status', 'sent')
        .order('sent_at', { ascending: false })
        .limit(20);

    console.log('Sample sent rows:', sampleSent);
}

inspectFailed().catch(console.error);
