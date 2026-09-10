import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkDetails() {
    const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
    
    // Check all broadcasts for this user
    const { data: broadcasts } = await supabaseAdmin
        .from('whatsapp_broadcasts')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    console.log('All broadcasts:', broadcasts);

    for (const b of (broadcasts || [])) {
        console.log(`\n=================== Broadcast: ${b.title} (${b.id}) [${b.status}] ===================`);
        console.log(`Created: ${b.created_at}, Sent: ${b.sent_at}, Template: ${b.template_name}`);

        const { data: recs, error: rErr } = await supabaseAdmin
            .from('whatsapp_broadcast_recipients')
            .select('*')
            .eq('broadcast_id', b.id);

        if (rErr) {
            console.error('Error fetching recipients:', rErr);
            continue;
        }

        console.log(`Total recipients: ${recs?.length}`);
        const statusMap: Record<string, number> = {};
        const failedReasons: Record<string, number> = {};
        const sampleErrors: any[] = [];

        for (const r of (recs || [])) {
            statusMap[r.status] = (statusMap[r.status] || 0) + 1;
            if (r.status === 'failed' || r.error_message) {
                const msg = r.error_message || 'Unknown error';
                failedReasons[msg] = (failedReasons[msg] || 0) + 1;
                if (sampleErrors.length < 5) {
                    sampleErrors.push({ phone: r.phone_number, error: r.error_message });
                }
            }
        }
        console.log('Status counts:', statusMap);
        console.log('Failed reasons summary:', failedReasons);
        console.log('Sample error rows:', sampleErrors);
    }
}

checkDetails().catch(console.error);
