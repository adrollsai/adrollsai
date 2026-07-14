require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function go() {
    const impId = '2f62a259-f23b-48ee-a920-cf36f36eaa4b';
    
    const { data: c1, count } = await s
        .from('whatsapp_chats')
        .select('id, user_id, recipient_name, recipient_phone', { count: 'exact' })
        .eq('user_id', impId)
        .limit(5);
    
    console.log('Chats for impersonated bluesquare user (' + impId + '):', count);
    if (c1) c1.forEach(c => console.log('  ', JSON.stringify(c)));

    const { data: all } = await s
        .from('whatsapp_chats')
        .select('id, user_id, recipient_name, recipient_phone')
        .order('updated_at', { ascending: false })
        .limit(15);
    
    console.log('\nRecent 15 chats:');
    const uids = new Set();
    if (all) {
        all.forEach(c => {
            uids.add(c.user_id);
            console.log('  ' + (c.recipient_name || '?') + ' | ' + c.recipient_phone + ' | user_id: ' + c.user_id);
        });
    }

    console.log('\nDistinct user_ids in chats:');
    for (const uid of uids) {
        const { data: p } = await s.from('profiles').select('email, business_name').eq('id', uid).single();
        console.log('  ' + uid + ' => ' + (p ? p.email + ' (' + (p.business_name || '') + ')' : 'NOT FOUND'));
    }
    
    const { data: bsProfile } = await s.from('profiles').select('id, email, business_name, whatsapp_phone_number_id, whatsapp_waba_id').eq('id', impId).single();
    console.log('\nBluesquare profile:', JSON.stringify(bsProfile, null, 2));
}

go().catch(console.error);
