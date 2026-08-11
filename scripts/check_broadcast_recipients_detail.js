const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    const bId = '2997f5e6-18af-4d2f-abad-9da087b67178';
    const userId = '2f62a259-f23b-48ee-a920-c436f36eaa4b';

    console.log('--- INSPECTING USER LEADS ---');
    const { count: leadCount } = await supabaseAdmin
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .or(`user_id.eq.${userId},assigned_to.eq.${userId}`);
    console.log('Total leads for Blue Square Infra:', leadCount);

    console.log('--- INSPECTING WHATSAPP CHATS & MESSAGES FOR USER ---');
    const { count: chatCount } = await supabaseAdmin
        .from('whatsapp_chats')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);
    console.log('Total whatsapp_chats:', chatCount);

    const { data: messages } = await supabaseAdmin
        .from('whatsapp_messages')
        .select('*')
        .ilike('message_text', '%investment_inquiry%')
        .limit(10);
    console.log('Messages with template name investment_inquiry:', messages ? messages.length : 0);

    console.log('--- CHECKING ALL ROWS IN whatsapp_broadcast_recipients ---');
    const { count: totalRecipientsInSystem } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('id', { count: 'exact', head: true });
    console.log('Total recipient rows in entire table:', totalRecipientsInSystem);

    const { data: sampleRecipients } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('*')
        .limit(10);
    console.log('Sample recipient rows:', sampleRecipients);
}

run().catch(console.error);
