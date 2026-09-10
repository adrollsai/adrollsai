import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check97Delivery() {
    const broadcastId = 'aa6efe5d-ae5d-488f-9b7f-05f7fbde3bbe';

    // Get all 97 sent recipients
    const { data: sentRecs } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('phone_number, lead_id, sent_at')
        .eq('broadcast_id', broadcastId)
        .eq('status', 'sent');

    console.log(`Checking delivery status of ${sentRecs?.length} sent messages...`);

    // Check chats for these phone numbers
    const phones = (sentRecs || []).map(r => r.phone_number.replace(/\D/g, '')).filter(Boolean);
    
    // Find failed messages among these
    const { data: chats } = await supabaseAdmin
        .from('whatsapp_chats')
        .select('id, recipient_phone, last_message_text')
        .eq('user_id', 'bc63c065-9bcc-4793-bedc-f0960406425b');

    let deliveredCount = 0;
    let failedDeliveryCount = 0;
    const failures: any[] = [];

    for (const c of (chats || [])) {
        if (c.last_message_text?.includes('Delivery Failed')) {
            failedDeliveryCount++;
            failures.push({ phone: c.recipient_phone, text: c.last_message_text });
        } else {
            deliveredCount++;
        }
    }

    console.log(`Chats analyzed: ${chats?.length}`);
    console.log(`Failed delivery webhooks: ${failedDeliveryCount}`);
    console.log(`Delivered or pending delivery: ${deliveredCount}`);
    console.log('Sample delivery failures on rchopra account:', failures.slice(0, 10));
}

check97Delivery().catch(console.error);
