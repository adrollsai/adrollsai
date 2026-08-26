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

    for (const [wabaId, info] of uniqueWabas.entries()) {
        console.log(`\n========================================`);
        console.log(`🏢 Account: ${info.business} (${info.email})`);
        console.log(`📱 WABA ID: ${wabaId}`);
        console.log(`========================================`);

        const postMetaUrl = `https://graph.facebook.com/v20.0/${wabaId}/message_templates`;

        // 1. Template: real_estate_tailored_inventory (Pure clean format)
        const templatePayload = {
            name: 'real_estate_tailored_inventory',
            category: 'MARKETING',
            language: 'en_US',
            components: [
                {
                    type: 'BODY',
                    text: 'Hi! 👋 Please answer a few quick questions so we can instantly send you a curated inventory list & brochure matched to your preferences: 🎁🏢'
                },
                {
                    type: 'BUTTONS',
                    buttons: [
                        {
                            type: 'QUICK_REPLY',
                            text: 'Answer Questions'
                        },
                        {
                            type: 'QUICK_REPLY',
                            text: 'View Properties'
                        },
                        {
                            type: 'QUICK_REPLY',
                            text: 'Talk to Expert'
                        }
                    ]
                }
            ]
        };

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
                console.warn(`⚠️ Error for real_estate_tailored_inventory:`, data.error);
            } else {
                console.log(`✅ Template 'real_estate_tailored_inventory' submitted! ID: ${data.id}, Status: ${data.status}`);
            }
        } catch (e: any) {
            console.error(`❌ Request error:`, e.message);
        }

        // 2. Personalized template with lead name {{1}}
        const personalizedPayload = {
            name: 'lead_inventory_survey',
            category: 'MARKETING',
            language: 'en_US',
            components: [
                {
                    type: 'BODY',
                    text: 'Hi {{1}}! 👋 Please answer a few quick questions so we can instantly send you a curated inventory list & brochure matched to your preferences: 🎁🏢',
                    example: {
                        body_text: [
                            ['Rahul']
                        ]
                    }
                },
                {
                    type: 'BUTTONS',
                    buttons: [
                        {
                            type: 'QUICK_REPLY',
                            text: 'Answer Questions'
                        },
                        {
                            type: 'QUICK_REPLY',
                            text: 'View Properties'
                        },
                        {
                            type: 'QUICK_REPLY',
                            text: 'Talk to Expert'
                        }
                    ]
                }
            ]
        };

        try {
            const res = await fetch(postMetaUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${info.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(personalizedPayload)
            });
            const data = await res.json();
            if (data.error) {
                console.warn(`⚠️ Error for lead_inventory_survey:`, data.error);
            } else {
                console.log(`✅ Template 'lead_inventory_survey' submitted! ID: ${data.id}, Status: ${data.status}`);
            }
        } catch (e: any) {
            console.error(`❌ Request error:`, e.message);
        }
    }

    console.log('\n🏁 Finished template submission across all accounts!');
}

main().catch(console.error);
