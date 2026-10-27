import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function fullCount() {
    const broadcastId = '07b6ef99-6f24-4309-a251-48fee7e29d2e';

    const { count: total } = await supabaseAdmin.from('whatsapp_broadcast_recipients').select('*', { count: 'exact', head: true }).eq('broadcast_id', broadcastId);
    const { count: sent } = await supabaseAdmin.from('whatsapp_broadcast_recipients').select('*', { count: 'exact', head: true }).eq('broadcast_id', broadcastId).eq('status', 'sent');
    const { count: failed } = await supabaseAdmin.from('whatsapp_broadcast_recipients').select('*', { count: 'exact', head: true }).eq('broadcast_id', broadcastId).eq('status', 'failed');
    const { count: pending } = await supabaseAdmin.from('whatsapp_broadcast_recipients').select('*', { count: 'exact', head: true }).eq('broadcast_id', broadcastId).eq('status', 'pending');

    console.log({ total, sent, failed, pending });
}

fullCount().catch(console.error);
