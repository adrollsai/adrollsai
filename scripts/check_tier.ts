import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkTier() {
    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', '2f62a259-f23b-48ee-a920-c436f36eaa4b')
        .single();

    const token = profile.whatsapp_access_token;
    const phoneId = profile.whatsapp_phone_number_id;

    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}?fields=messaging_limit_tier,status,quality_rating`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    const data = await res.json();
    console.log('Tier response:', data);
}

checkTier().catch(console.error);
