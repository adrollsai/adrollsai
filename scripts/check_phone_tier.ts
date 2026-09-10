import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkPhoneTier() {
    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('email', 'rchopra489@gmail.com')
        .single();

    const token = profile.whatsapp_access_token;
    const phoneId = profile.whatsapp_phone_number_id;

    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}?fields=messaging_limit_tier,quality_rating,name_status`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('Phone tier info:', await res.json());
}

checkPhoneTier().catch(console.error);
