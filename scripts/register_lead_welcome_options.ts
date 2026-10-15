import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
    console.log('🚀 Fetching all active WABA accounts...');
    const { data: profiles, error } = await supabase
        .from('profiles')
        .select('id, email, business_name, whatsapp_waba_id, whatsapp_access_token, facebook_token')
        .not('whatsapp_waba_id', 'is', null);

    if (error || !profiles) {
        console.error('Failed to fetch profiles:', error);
        return;
    }

    const uniqueWabas = new Map<string, { token: string; email: string; business: string }>();
    for (const p of profiles) {
        const token = p.whatsapp_access_token || p.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN;
        if (p.whatsapp_waba_id && token && !uniqueWabas.has(p.whatsapp_waba_id)) {
            uniqueWabas.set(p.whatsapp_waba_id, {
                token,
                email: p.email || 'N/A',
                business: p.business_name || 'N/A'
            });
        }
    }

    console.log(`Processing ${uniqueWabas.size} unique WhatsApp Business Accounts (WABAs)...`);

    const templatePayload = {
        name: 'lead_welcome_options',
        category: 'MARKETING',
        language: 'en_US',
        components: [
            {
                type: 'BODY',
                text: 'Hi {{1}}! 👋 Welcome to {{2}}. Thank you for connecting with us regarding our properties and projects.\n\nHow would you like to proceed?',
                example: {
                    body_text: [
                        ['Rahul', 'Blue Square Infra']
                    ]
                }
            },
            {
                type: 'BUTTONS',
                buttons: [
                    {
                        type: 'QUICK_REPLY',
                        text: 'View Properties'
                    },
                    {
                        type: 'QUICK_REPLY',
                        text: 'Connect with Expert'
                    },
                    {
                        type: 'QUICK_REPLY',
                        text: 'Book an appointment'
                    }
                ]
            }
        ]
    };

    for (const [wabaId, info] of uniqueWabas.entries()) {
        console.log(`\n========================================`);
        console.log(`🏢 Account: ${info.business} (${info.email})`);
        console.log(`📱 WABA ID: ${wabaId}`);
        console.log(`========================================`);

        const postMetaUrl = `https://graph.facebook.com/v20.0/${wabaId}/message_templates`;

        try {
            const res = await fetch(postMetaUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${info.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(templatePayload)
            });
            const data = await res.json();
            if (data.error) {
                console.warn(`⚠️ Result for lead_welcome_options:`, data.error.message);
            } else {
                console.log(`✅ Template 'lead_welcome_options' submitted! ID: ${data.id}, Status: ${data.status}`);
            }
        } catch (e: any) {
            console.error(`❌ Request error:`, e.message);
        }
    }

    console.log('\n🏁 Finished template submission across all accounts!');
}

main().catch(console.error);
