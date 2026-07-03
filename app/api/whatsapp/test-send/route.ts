import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function POST(req: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { recipient, templateName, isSandboxTest } = await req.json();
        if (!recipient) {
            return NextResponse.json({ error: 'Recipient phone number is required' }, { status: 400 });
        }

        // Fetch WhatsApp credentials
        const { data: profile } = await supabase
            .from('profiles')
            .select('whatsapp_access_token, whatsapp_phone_number_id')
            .eq('id', user.id)
            .single();

        if (!profile || !profile.whatsapp_access_token || !profile.whatsapp_phone_number_id) {
            return NextResponse.json({ error: 'WhatsApp credentials not found. Please connect your account first.' }, { status: 400 });
        }

        // Clean recipient number (keep only digits and format with country code fallback)
        let cleanRecipient = recipient.replace(/\D/g, '');
        if (cleanRecipient.startsWith('00')) {
            cleanRecipient = cleanRecipient.substring(2);
        }
        if (cleanRecipient.length === 10) {
            cleanRecipient = '91' + cleanRecipient;
        } else if (cleanRecipient.length === 11 && cleanRecipient.startsWith('0')) {
            cleanRecipient = '91' + cleanRecipient.substring(1);
        }

        // Use standard sandbox template if requested
        const payloadTemplateName = isSandboxTest ? 'hello_world' : (templateName || 'hello_world');

        const messagePayload: any = {
            messaging_product: 'whatsapp',
            to: cleanRecipient,
            type: 'template',
            template: {
                name: payloadTemplateName,
                language: {
                    code: 'en_US'
                }
            }
        };

        // Inject parameters if using actual real estate templates
        if (!isSandboxTest) {
            if (templateName === 'real_estate_welcome_1') {
                messagePayload.template.components = [
                    {
                        type: 'body',
                        parameters: [
                            { type: 'text', text: 'Valued Lead' },
                            { type: 'text', text: 'Sunshine Apartments' },
                            { type: 'text', text: 'Adrolls Real Estate' }
                        ]
                    }
                ];
            } else if (templateName === 'real_estate_reminder_1') {
                messagePayload.template.components = [
                    {
                        type: 'body',
                        parameters: [
                            { type: 'text', text: 'Valued Lead' },
                            { type: 'text', text: 'Sunshine Apartments' },
                            { type: 'text', text: 'Tomorrow at 10:00 AM' }
                        ]
                    }
                ];
            } else if (templateName === 'real_estate_alert_1') {
                messagePayload.template.components = [
                    {
                        type: 'body',
                        parameters: [
                            { type: 'text', text: 'Valued Lead' },
                            { type: 'text', text: 'Sunshine Apartments' },
                            { type: 'text', text: '₹75 Lakhs' }
                        ]
                    }
                ];
            }
        }

        const metaUrl = `https://graph.facebook.com/v20.0/${profile.whatsapp_phone_number_id}/messages`;
        const metaRes = await fetch(metaUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${profile.whatsapp_access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(messagePayload)
        });

        const metaData = await metaRes.json();

        if (metaData.error) {
            console.error('[WHATSAPP TEST SEND] Meta API Error:', metaData.error);
            return NextResponse.json({ 
                error: metaData.error.message || 'Meta API returned an error.',
                details: metaData.error
            }, { status: 400 });
        }

        return NextResponse.json({ success: true, messageId: metaData.messages?.[0]?.id });
    } catch (err: any) {
        console.error('[WHATSAPP TEST SEND] Unexpected Error:', err);
        return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
}
