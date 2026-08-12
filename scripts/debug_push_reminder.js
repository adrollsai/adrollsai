const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function debugReminderPush() {
    console.log('--- DEBUGGING REMINDER PUSH NOTIFICATION ---');

    // 1. Check leads with next_followup set around 10:21 AM IST today (04:51:00 UTC)
    const { data: recentLeads } = await supabaseAdmin
        .from('leads')
        .select('id, name, phone, user_id, assigned_to, next_followup')
        .not('next_followup', 'is', null)
        .order('created_at', { ascending: false })
        .limit(10);

    console.log('Leads with active next_followup:', recentLeads);

    // 2. Check push subscriptions for main user IDs
    const userIds = [
        '2f62a259-f23b-48ee-a920-c436f36eaa4b', // infobluesquareinfra@gmail.com
        'bc63c065-9bcc-4793-bedc-f0960406425b',
        'b1645a6d-4b73-41ef-a197-8247d0168905'  // nobogent@gmail.com
    ];

    const { data: subscriptions } = await supabaseAdmin
        .from('push_subscriptions')
        .select('*')
        .in('user_id', userIds);

    console.log('Push subscriptions found:', subscriptions);

    // 3. Check notifications table for logged alerts
    const { data: notifications } = await supabaseAdmin
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

    console.log('Recent notifications logged:', notifications);
}

debugReminderPush().catch(console.error);
