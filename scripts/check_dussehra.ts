import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkDussehra() {
    const { count } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('*', { count: 'exact', head: true })
        .eq('broadcast_id', 'df9369ff-5a04-49c8-90ba-c323d9dc24fb')
        .eq('status', 'pending');

    console.log('Dussehra pending count:', count);
}

checkDussehra().catch(console.error);
