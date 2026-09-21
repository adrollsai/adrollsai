import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function checkProfile() {
    const { data: profile } = await supabase
        .from('profiles')
        .select('id, email, business_name, voice_provider, voice_twilio_sid, voice_twilio_number, voice_vobiz_number, voice_vobiz_auth_id, business_info')
        .eq('id', 'c3893924-5a57-4da3-b4bc-7c70d8ee7c59')
        .single();

    console.log("PROFILE VOICE SETTINGS:", profile);
}

checkProfile().catch(console.error);
