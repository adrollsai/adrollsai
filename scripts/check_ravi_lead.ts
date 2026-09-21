import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function check() {
    const { data: p } = await supabase.from('profiles').select('*').eq('id', 'c3893924-5a57-4da3-b4bc-7c70d8ee7c59').single();
    console.log("OWNER PROFILE ALL FIELDS:");
    for (const [k, v] of Object.entries(p || {})) {
        if (k.includes('voice') || k.includes('phone') || k.includes('info') || k.includes('kyc') || k.includes('vobiz') || k.includes('twilio')) {
            console.log(`  ${k}:`, v);
        }
    }
}

check().catch(console.error);
