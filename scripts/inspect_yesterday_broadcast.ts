import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function inspectYesterdayBroadcast() {
    const broadcastId = '07b6ef99-6f24-4309-a251-48fee7e29d2e';
    const userId = '2f62a259-f23b-48ee-a920-c436f36eaa4b';

    // 1. Get profile
    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
    console.log('Profile:', {
        id: profile?.id,
        email: profile?.email,
        business_name: profile?.business_name,
        full_name: profile?.full_name,
        phone_number_id: profile?.whatsapp_phone_number_id,
        waba_id: profile?.whatsapp_waba_id,
        has_token: !!profile?.whatsapp_access_token
    });

    // 2. Get broadcast
    const { data: broadcast } = await supabaseAdmin
        .from('whatsapp_broadcasts')
        .select('*')
        .eq('id', broadcastId)
        .single();
    console.log('Broadcast:', broadcast);

    // 3. Count recipients
    const { count: totalRecipients } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('broadcast_id', broadcastId);

    const { count: sentCount } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('broadcast_id', broadcastId)
        .eq('status', 'sent');

    const { count: failedCount } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('broadcast_id', broadcastId)
        .eq('status', 'failed');

    const { count: pendingCount } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('broadcast_id', broadcastId)
        .eq('status', 'pending');

    const { count: otherCount } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('broadcast_id', broadcastId)
        .not('status', 'in', '("sent","failed","pending")');

    console.log('Recipient status counts:', {
        totalRecipients,
        sentCount,
        failedCount,
        pendingCount,
        otherCount
    });

    // 4. Sample sent recipients
    const { data: sentSamples } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('id, phone_number, status, sent_at, error_message')
        .eq('broadcast_id', broadcastId)
        .eq('status', 'sent')
        .order('sent_at', { ascending: false })
        .limit(10);
    console.log('Sample Sent Recipients:', sentSamples);

    // 5. Sample failed recipients
    const { data: failedSamples } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('id, phone_number, status, sent_at, error_message')
        .eq('broadcast_id', broadcastId)
        .eq('status', 'failed')
        .limit(10);
    console.log('Sample Failed Recipients:', failedSamples);

    // 6. Check total leads for this user
    const { count: totalUserLeads } = await supabaseAdmin
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);

    console.log('Total Leads for User in `leads` table:', totalUserLeads);

    // Check if there are other broadcasts for this user
    const { data: userBroadcasts } = await supabaseAdmin
        .from('whatsapp_broadcasts')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
    console.log('All broadcasts for this user:', userBroadcasts);
}

inspectYesterdayBroadcast().catch(console.error);
