import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkAllFailed() {
    const broadcastId = '07b6ef99-6f24-4309-a251-48fee7e29d2e';

    let page = 0;
    const pageSize = 1000;
    const errorMap: Record<string, number> = {};
    let totalFailedExamined = 0;

    while (true) {
        const { data: batch, error } = await supabaseAdmin
            .from('whatsapp_broadcast_recipients')
            .select('id, error_message, phone_number')
            .eq('broadcast_id', broadcastId)
            .eq('status', 'failed')
            .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error || !batch || batch.length === 0) break;

        for (const r of batch) {
            totalFailedExamined++;
            const err = r.error_message || 'No error message';
            errorMap[err] = (errorMap[err] || 0) + 1;
        }

        if (batch.length < pageSize) break;
        page++;
    }

    console.log('Total failed examined:', totalFailedExamined);
    console.log('Error counts:', errorMap);
}

checkAllFailed().catch(console.error);
