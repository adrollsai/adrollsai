import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkStatuses() {
    const broadcastId = 'ecd17a20-5f12-4a2d-902b-542492e1e9b0';
    console.log(`--- CHECKING RECIPIENTS FOR BROADCAST ${broadcastId} ---`);

    const { data: recipients } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('id, status, error_message, phone_number, lead_id')
        .eq('broadcast_id', broadcastId);

    if (!recipients) return console.log('No recipients');

    const counts: Record<string, number> = {};
    const sampleErrors: Record<string, string> = {};

    for (const r of recipients) {
        counts[r.status] = (counts[r.status] || 0) + 1;
        if (r.error_message && !sampleErrors[r.error_message]) {
            sampleErrors[r.error_message] = r.phone_number;
        }
    }

    console.log('Status counts:', counts);
    console.log('Sample error messages:', sampleErrors);
}

checkStatuses().catch(console.error);
