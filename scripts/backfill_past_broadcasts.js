const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function backfill() {
    console.log('--- STARTING CLEAN BACKFILL FOR PAST BROADCASTS ---');

    const b1Id = 'ecd17a20-5f12-4a2d-902b-542492e1e9b0'; // Investment Inquiry 1-500
    const b2Id = '2997f5e6-18af-4d2f-abad-9da087b67178'; // investment_inquiry_2
    const userId = '2f62a259-f23b-48ee-a920-c436f36eaa4b';

    // Delete any existing sample rows first
    await supabaseAdmin.from('whatsapp_broadcast_recipients').delete().in('broadcast_id', [b1Id, b2Id]);

    // 1. Fetch leads for b1 (500 leads created before 2026-07-28)
    const { data: leads1 } = await supabaseAdmin
        .from('leads')
        .select('id, phone, created_at')
        .or(`user_id.eq.${userId},assigned_to.eq.${userId}`)
        .lte('created_at', '2026-07-28T23:59:59Z')
        .order('created_at', { ascending: true })
        .limit(500);

    console.log(`Found ${leads1 ? leads1.length : 0} leads for Broadcast 1 (1-500)`);

    if (leads1 && leads1.length > 0) {
        const rows1 = leads1.map(l => ({
            broadcast_id: b1Id,
            lead_id: l.id,
            user_id: userId,
            phone_number: l.phone || '',
            status: 'sent',
            sent_at: '2026-07-28T12:17:18.344Z'
        })).filter(r => !!r.phone_number);

        for (let i = 0; i < rows1.length; i += 100) {
            const batch = rows1.slice(i, i + 100);
            const { error } = await supabaseAdmin.from('whatsapp_broadcast_recipients').insert(batch);
            if (error) console.error('Insert error b1:', error);
        }
        console.log(`Successfully inserted ${rows1.length} recipients for Broadcast 1`);
    }

    // 2. Fetch leads for b2 (1000 leads created before 2026-07-30)
    const { data: leads2 } = await supabaseAdmin
        .from('leads')
        .select('id, phone, created_at')
        .or(`user_id.eq.${userId},assigned_to.eq.${userId}`)
        .lte('created_at', '2026-07-30T23:59:59Z')
        .order('created_at', { ascending: true })
        .limit(1000);

    console.log(`Found ${leads2 ? leads2.length : 0} leads for Broadcast 2 (investment_inquiry_2)`);

    if (leads2 && leads2.length > 0) {
        const rows2 = leads2.map(l => ({
            broadcast_id: b2Id,
            lead_id: l.id,
            user_id: userId,
            phone_number: l.phone || '',
            status: 'sent',
            sent_at: '2026-07-30T07:51:36.843Z'
        })).filter(r => !!r.phone_number);

        for (let i = 0; i < rows2.length; i += 100) {
            const batch = rows2.slice(i, i + 100);
            const { error } = await supabaseAdmin.from('whatsapp_broadcast_recipients').insert(batch);
            if (error) console.error('Insert error b2:', error);
        }
        console.log(`Successfully inserted ${rows2.length} recipients for Broadcast 2`);
    }

    console.log('--- CLEAN BACKFILL COMPLETE ---');
}

backfill().catch(console.error);
