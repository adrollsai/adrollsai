import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function resetInBatches() {
    const broadcastId = '07b6ef99-6f24-4309-a251-48fee7e29d2e';

    console.log('Fetching recipients with error 131042...');
    let allIds: string[] = [];
    let page = 0;
    const pageSize = 500;

    while (true) {
        const { data, error } = await supabaseAdmin
            .from('whatsapp_broadcast_recipients')
            .select('id')
            .eq('broadcast_id', broadcastId)
            .eq('status', 'failed')
            .ilike('error_message', '%131042%')
            .order('id')
            .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) {
            console.error('Fetch error:', error);
            break;
        }
        if (!data || data.length === 0) break;
        allIds = allIds.concat(data.map(d => d.id));
        console.log(`Fetched page ${page}, total so far: ${allIds.length}`);
        if (data.length < pageSize) break;
        page++;
    }

    console.log(`Found ${allIds.length} failed recipients with 131042 to reset.`);

    // Update in batches of 100
    for (let i = 0; i < allIds.length; i += 100) {
        const batchIds = allIds.slice(i, i + 100);
        const { error } = await supabaseAdmin
            .from('whatsapp_broadcast_recipients')
            .update({
                status: 'pending',
                error_message: null,
                sent_at: null
            })
            .in('id', batchIds);

        if (error) {
            console.error(`Error updating batch ${i}:`, error);
        } else {
            console.log(`Reset batch ${i} to ${i + batchIds.length}`);
        }
    }

    const { count: pending } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('*', { count: 'exact', head: true })
        .eq('broadcast_id', broadcastId)
        .eq('status', 'pending');

    const { count: sent } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('*', { count: 'exact', head: true })
        .eq('broadcast_id', broadcastId)
        .eq('status', 'sent');

    const { count: failed } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('*', { count: 'exact', head: true })
        .eq('broadcast_id', broadcastId)
        .eq('status', 'failed');

    console.log('FINAL COUNTS:', { pending, sent, failed });
}

resetInBatches().catch(console.error);
