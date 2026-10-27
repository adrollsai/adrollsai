import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function inspectMeta() {
    const { data: p } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', '2f62a259-f23b-48ee-a920-c436f36eaa4b')
        .single();

    const token = p.whatsapp_access_token;
    const phoneId = p.whatsapp_phone_number_id;
    const wabaId = '1961706644524869';

    console.log('Phone ID:', phoneId, 'Testing WABA ID:', wabaId);

    const resWaba = await fetch(`https://graph.facebook.com/v20.0/${wabaId}?fields=id,name,currency,timezone_id,account_review_status,primary_funding_id`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    console.log('WABA details:', await resWaba.json());

    // Check payment methods or credit line
    const resFunding = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/extended_credits`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Extended credits:', await resFunding.json());
}

inspectMeta().catch(console.error);
