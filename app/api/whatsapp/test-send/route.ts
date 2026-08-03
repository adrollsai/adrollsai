import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function POST(req: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { recipient, templateName, isSandboxTest, parameters, variableValues, language } = await req.json();
        if (!recipient) {
            return NextResponse.json({ error: 'Recipient phone number is required' }, { status: 400 });
        }

        // Fetch WhatsApp credentials
        const { data: profile } = await supabase
            .from('profiles')
            .select('whatsapp_access_token, whatsapp_phone_number_id, whatsapp_waba_id, facebook_token, email')
            .eq('id', user.id)
            .single();

        const isMasterDefaultUser = profile?.email === 'rchopra489@gmail.com' || profile?.email === 'infobluesquareinfra@gmail.com';
        const whatsappToken = profile?.whatsapp_access_token || profile?.facebook_token || (isMasterDefaultUser ? process.env.DEV_WHATSAPP_ACCESS_TOKEN : null);
        const whatsappPhoneId = profile?.whatsapp_phone_number_id || (isMasterDefaultUser ? process.env.DEV_WHATSAPP_PHONE_ID : null);
        const whatsappWabaId = profile?.whatsapp_waba_id || (isMasterDefaultUser ? process.env.DEV_WHATSAPP_WABA_ID : null);

        if (!whatsappToken || !whatsappPhoneId) {
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

        let targetLanguage = language || 'en_US';
        const components: any[] = [];

        // Attempt to inspect actual Meta WABA template definition for precise parameter & language matching
        if (!isSandboxTest && whatsappWabaId && payloadTemplateName !== 'hello_world') {
            try {
                const metaTemplateUrl = `https://graph.facebook.com/v20.0/${whatsappWabaId}/message_templates?name=${payloadTemplateName}&access_token=${whatsappToken}`;
                const tRes = await fetch(metaTemplateUrl);
                if (tRes.ok) {
                    const tData = await tRes.json();
                    const templateDef = tData.data?.[0];
                    if (templateDef) {
                        if (templateDef.language) {
                            targetLanguage = templateDef.language;
                        }
                        
                        if (Array.isArray(templateDef.components)) {
                            // 1. HEADER component check (IMAGE, VIDEO, DOCUMENT, TEXT with parameters)
                            const headerComp = templateDef.components.find((c: any) => c.type === 'HEADER');
                            const defaultVideo = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/library/bc63c065-9bcc-4793-bedc-f0960406425b/1785562776349-reelvideo.mp4';
                            const defaultImage = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/2f62a259-f23b-48ee-a920-c436f36eaa4b/1778143153926.png';
                            const providedMedia = (req as any).headerMediaUrl || (req as any).mediaUrl || null;

                            if (headerComp) {
                                if (headerComp.format === 'VIDEO') {
                                    components.push({
                                        type: 'header',
                                        parameters: [
                                            {
                                                type: 'video',
                                                video: {
                                                    link: providedMedia || defaultVideo
                                                }
                                            }
                                        ]
                                    });
                                } else if (headerComp.format === 'IMAGE') {
                                    components.push({
                                        type: 'header',
                                        parameters: [
                                            {
                                                type: 'image',
                                                image: {
                                                    link: providedMedia || defaultImage
                                                }
                                            }
                                        ]
                                    });
                                } else if (headerComp.format === 'DOCUMENT') {
                                    components.push({
                                        type: 'header',
                                        parameters: [
                                            {
                                                type: 'document',
                                                document: {
                                                    link: providedMedia || defaultVideo
                                                }
                                            }
                                        ]
                                    });
                                } else if (headerComp.format === 'TEXT' && headerComp.text && headerComp.text.includes('{{1}}')) {
                                    components.push({
                                        type: 'header',
                                        parameters: [{ type: 'text', text: 'Valued Customer' }]
                                    });
                                }
                            }

                            // 2. BODY components parameters check
                            const bodyComp = templateDef.components.find((c: any) => c.type === 'BODY');
                            if (bodyComp && bodyComp.text) {
                                const varCount = (bodyComp.text.match(/\{\{\d+\}\}/g) || []).length;
                                if (varCount > 0) {
                                    const bodyParams: any[] = [];
                                    const rawProvided = Array.isArray(parameters) && parameters.length > 0
                                        ? parameters
                                        : (Array.isArray(variableValues) ? variableValues : []);

                                    for (let i = 0; i < varCount; i++) {
                                        const p = rawProvided[i];
                                        let textVal = typeof p === 'string' ? p : (p?.text || '');
                                        textVal = textVal.trim();
                                        if (!textVal) {
                                            textVal = i === 0 ? 'Valued Customer' : i === 1 ? 'Partner' : 'Details';
                                        }
                                        bodyParams.push({ type: 'text', text: textVal });
                                    }

                                    components.push({
                                        type: 'body',
                                        parameters: bodyParams
                                    });
                                }
                            }
                        }
                    }
                }
            } catch (inspectErr) {
                console.warn('[WHATSAPP TEST SEND] Failed to inspect Meta template definition, using fallback logic:', inspectErr);
            }
        }

        // Fallback parameter formatting if components array wasn't built via Meta API definition
        if (components.length === 0 && !isSandboxTest && payloadTemplateName !== 'hello_world') {
            const rawProvided = Array.isArray(parameters) && parameters.length > 0
                ? parameters
                : (Array.isArray(variableValues) ? variableValues : []);

            if (payloadTemplateName.toLowerCase().includes('vsl') || payloadTemplateName.toLowerCase().includes('video')) {
                components.push({
                    type: 'header',
                    parameters: [
                        {
                            type: 'video',
                            video: {
                                link: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/library/bc63c065-9bcc-4793-bedc-f0960406425b/1785562776349-reelvideo.mp4'
                            }
                        }
                    ]
                });
            }

            if (rawProvided.length > 0) {
                const bodyParams = rawProvided.map((p: any, idx: number) => {
                    let textVal = typeof p === 'string' ? p : (p?.text || '');
                    textVal = textVal.trim();
                    if (!textVal) {
                        textVal = idx === 0 ? 'Valued Customer' : idx === 1 ? 'Partner' : 'Details';
                    }
                    return { type: 'text', text: textVal };
                });

                components.push({
                    type: 'body',
                    parameters: bodyParams
                });
            }
        }

        const messagePayload: any = {
            messaging_product: 'whatsapp',
            to: cleanRecipient,
            type: 'template',
            template: {
                name: payloadTemplateName,
                language: {
                    code: targetLanguage
                }
            }
        };

        if (components.length > 0) {
            messagePayload.template.components = components;
        }

        const metaUrl = `https://graph.facebook.com/v20.0/${whatsappPhoneId}/messages`;
        const metaRes = await fetch(metaUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${whatsappToken}`,
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
