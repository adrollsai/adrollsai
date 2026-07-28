import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkRecipients() {
    const broadcastId = 'ecd17a20-5f12-4a2d-902b-542492e1e9b0';
    console.log(`--- CHECKING RECIPIENTS FOR BROADCAST ${broadcastId} ---`);

    const { count, data: recipients } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('*', { count: 'exact' })
        .eq('broadcast_id', broadcastId);

    console.log(`Total Recipients inserted: ${count}`);
    if (recipients && recipients.length > 0) {
        console.log('Sample recipient status:', recipients.slice(0, 10));
        
        // Count statuses
        const statusCounts: Record<string, number> = {};
        for (const r of recipients) {
            statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
        }
        console.log('Status Breakdown:', statusCounts);

        // Show any errors
        const failed = recipients.filter(r => r.status === 'failed');
        if (failed.length > 0) {
            console.log('Sample failed error message:', failed[0].error_message);
        }
    }
}

checkRecipients().catch(console.error);
