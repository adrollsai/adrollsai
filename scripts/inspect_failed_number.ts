import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function inspectFailedNumber() {
    const phone = '+91 9728958196';
    console.log(`--- INSPECTING RECIPIENT FOR ${phone} ---`);

    const { data: recipient } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('*')
        .eq('phone_number', phone)
        .maybeSingle();

    console.log('Recipient record:', recipient);
}

inspectFailedNumber().catch(console.error);
