import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function checkUmang() {
    const userId = 'b685d287-7d54-4c9c-ae03-a46bb96ebdde'; // Umang Associates

    const { data: profile, error } = await supabase
        .from('profiles')
        .select('id, email, business_name, whatsapp_access_token, whatsapp_phone_number_id, whatsapp_waba_id, facebook_token, whatsapp_business_account_id, whatsapp_phone_number')
        .eq('id', userId)
        .single();

    if (error) {
        console.error('Error fetching profile:', error);
        return;
    }

    console.log('Profile found:', {
        id: profile.id,
        email: profile.email,
        business_name: profile.business_name,
        whatsapp_phone_number: profile.whatsapp_phone_number,
        whatsapp_phone_number_id: profile.whatsapp_phone_number_id,
        whatsapp_waba_id: profile.whatsapp_waba_id || profile.whatsapp_business_account_id,
        has_whatsapp_access_token: !!profile.whatsapp_access_token,
        has_facebook_token: !!profile.facebook_token,
        token_prefix: (profile.whatsapp_access_token || profile.facebook_token || '').substring(0, 15)
    });

    const token = profile.whatsapp_access_token || profile.facebook_token;
    const phoneId = profile.whatsapp_phone_number_id;
    const wabaId = profile.whatsapp_waba_id || profile.whatsapp_business_account_id;

    if (!token) {
        console.log('No token found for Umang!');
        return;
    }

    // 1. Check Phone Number info from Meta
    if (phoneId) {
        console.log('\n--- Fetching Phone Number Info from Meta ---');
        const phoneRes = await fetch(`https://graph.facebook.com/v20.0/${phoneId}?access_token=${token}`);
        const phoneData = await phoneRes.json();
        console.log('Phone details:', phoneData);
    }

    // 2. Fetch Templates from Meta WABA
    if (wabaId) {
        console.log('\n--- Fetching Templates from WABA:', wabaId, '---');
        const tplRes = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?limit=100&access_token=${token}`);
        const tplData = await tplRes.json();
        if (tplData.data) {
            console.log(`Found ${tplData.data.length} templates:`);
            for (const t of tplData.data) {
                console.log(`- Name: ${t.name} | Status: ${t.status} | Category: ${t.category} | Lang: ${t.language}`);
                console.log('  Components:', JSON.stringify(t.components, null, 2));
            }
        } else {
            console.log('Template fetch response:', tplData);
        }
    }
}

checkUmang().catch(console.error);
