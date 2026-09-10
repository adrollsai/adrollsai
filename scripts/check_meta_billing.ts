import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkMetaBilling() {
    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('email', 'rchopra489@gmail.com')
        .single();

    if (!profile) return console.log('No profile found');

    const token = profile.whatsapp_access_token;
    const wabaId = profile.whatsapp_waba_id;
    const phoneId = profile.whatsapp_phone_number_id;

    console.log('Testing Meta Graph API with WABA:', wabaId, 'Phone:', phoneId);

    // 1. Phone number details & quality rating & messaging tier & account mode
    const pRes = await fetch(`https://graph.facebook.com/v20.0/${phoneId}?fields=display_phone_number,verified_name,code_verification_status,quality_rating,messaging_limit_tier,status,throughput,is_official_business_account,account_mode`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('Phone details:', await pRes.json());

    // 2. WABA details & review status & currency & timezone
    const wRes = await fetch(`https://graph.facebook.com/v20.0/${wabaId}?fields=name,account_review_status,currency,timezone_id,message_template_namespace,on_behalf_of_business_info,primary_funding_id`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('WABA details:', await wRes.json());

    // 3. Try to check payment methods / extended credit / billing
    const payRes = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/extended_credit_lines`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('Extended credit lines:', await payRes.json());

    // 4. Try to check conversation analytics or payment info
    const fundingRes = await fetch(`https://graph.facebook.com/v20.0/${wabaId}?fields=primary_funding_id,payment_configuration`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    console.log('Funding / Payment config:', await fundingRes.json());
}

checkMetaBilling().catch(console.error);
