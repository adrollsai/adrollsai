import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkTemplateDetails() {
    const userId = '2f62a259-f23b-48ee-a920-c436f36eaa4b'; // Blue Square Infra
    const { data: profile } = await supabaseAdmin.from('profiles').select('whatsapp_access_token, whatsapp_waba_id').eq('id', userId).single();
    if (!profile) return console.log('Profile not found');

    const wabaId = profile.whatsapp_waba_id || '120286891256372';
    const token = profile.whatsapp_access_token;

    console.log(`Fetching templates for WABA ID: ${wabaId}...`);
    const res = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?limit=100`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    
    if (data.data) {
        const invTpl = data.data.find((t: any) => t.name === 'investment_inquiry');
        console.log('\n--- TEMPLATE STRUCTURE FOR investment_inquiry ---');
        console.log(JSON.stringify(invTpl, null, 2));
    } else {
        console.log('Error fetching templates:', data);
    }
}

checkTemplateDetails().catch(console.error);
