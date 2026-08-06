import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function POST(req: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { recipient, templateName, isSandboxTest, parameters, variableValues, language, headerMediaUrl } = await req.json();
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
                            const sanitizeMediaUrl = (u: string | null) => u ? u.replace('r2.dev/adrolls-storage/', 'r2.dev/') : null;
                            const providedMedia = sanitizeMediaUrl(headerMediaUrl || null);

                            if (headerComp) {
                                const fmt = (headerComp.format || '').toUpperCase();
                                if (['VIDEO', 'IMAGE', 'DOCUMENT'].includes(fmt)) {
                                    if (!providedMedia) {
                                        return NextResponse.json({
                                            error: `Header media (${fmt}) is required for template '${payloadTemplateName}'. Please select or upload a media file.`
                                        }, { status: 400 });
                                    }
                                    const mediaTypeKey = fmt.toLowerCase();
                                    components.push({
                                        type: 'header',
                                        parameters: [
                                            {
                                                type: mediaTypeKey,
                                                [mediaTypeKey]: {
                                                    link: providedMedia
                                                }
                                            }
                                        ]
                                    });
                                } else if (fmt === 'TEXT' && headerComp.text && headerComp.text.includes('{{1}}')) {
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

        // LOG FULL PAYLOAD for debugging delivery issues
        console.log('[WHATSAPP TEST SEND] ===== FULL META API REQUEST =====');
        console.log('[WHATSAPP TEST SEND] URL:', `https://graph.facebook.com/v20.0/${whatsappPhoneId}/messages`);
        console.log('[WHATSAPP TEST SEND] Recipient:', cleanRecipient);
        console.log('[WHATSAPP TEST SEND] Template:', payloadTemplateName);
        console.log('[WHATSAPP TEST SEND] Language:', targetLanguage);
        console.log('[WHATSAPP TEST SEND] Components:', JSON.stringify(components, null, 2));
        console.log('[WHATSAPP TEST SEND] Full Payload:', JSON.stringify(messagePayload, null, 2));

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

        // LOG FULL RESPONSE for debugging delivery issues
        console.log('[WHATSAPP TEST SEND] ===== META API RESPONSE =====');
        console.log('[WHATSAPP TEST SEND] HTTP Status:', metaRes.status);
        console.log('[WHATSAPP TEST SEND] Response Body:', JSON.stringify(metaData, null, 2));

        if (metaData.error) {
            console.error('[WHATSAPP TEST SEND] Meta API Error:', JSON.stringify(metaData.error, null, 2));
            return NextResponse.json({ 
                error: metaData.error.message || 'Meta API returned an error.',
                details: metaData.error,
                debug: {
                    httpStatus: metaRes.status,
                    recipient: cleanRecipient,
                    template: payloadTemplateName,
                    language: targetLanguage,
                    componentCount: components.length,
                    phoneId: whatsappPhoneId,
                }
            }, { status: 400 });
        }

        const messageId = metaData.messages?.[0]?.id;
        const messageStatus = metaData.messages?.[0]?.message_status;
        
        console.log('[WHATSAPP TEST SEND] ✅ Message accepted by Meta. ID:', messageId, 'Status:', messageStatus || 'accepted');

        // Persist sent template message to DB for conversation history
        try {
            const rawPhoneDigits = cleanRecipient.replace(/\D/g, '');
            const nowIso = new Date().toISOString();

            // 1. Get or create WhatsApp chat
            let { data: existingChat } = await supabase
                .from('whatsapp_chats')
                .select('id')
                .eq('user_id', user.id)
                .eq('recipient_phone', rawPhoneDigits)
                .maybeSingle();

            if (!existingChat) {
                const { data: newChat } = await supabase
                    .from('whatsapp_chats')
                    .insert({
                        user_id: user.id,
                        recipient_phone: rawPhoneDigits,
                        recipient_name: '+' + rawPhoneDigits,
                        unread_count: 0,
                        last_message_text: `Sent Template: ${payloadTemplateName}`,
                        updated_at: nowIso
                    })
                    .select('id')
                    .single();
                existingChat = newChat;
            } else {
                await supabase
                    .from('whatsapp_chats')
                    .update({
                        last_message_text: `Sent Template: ${payloadTemplateName}`,
                        updated_at: nowIso
                    })
                    .eq('id', existingChat.id);
            }

            // 2. Insert WhatsApp message record
            if (existingChat?.id) {
                await supabase.from('whatsapp_messages').insert({
                    chat_id: existingChat.id,
                    direction: 'outbound',
                    message_text: `Sent Template: ${payloadTemplateName}`,
                    created_at: nowIso
                });
            }
        } catch (dbErr) {
            console.warn('[WHATSAPP TEST SEND] DB record insertion warning (non-fatal):', dbErr);
        }

        return NextResponse.json({ 
            success: true, 
            messageId,
            debug: {
                httpStatus: metaRes.status,
                recipient: cleanRecipient,
                template: payloadTemplateName,
                language: targetLanguage,
                componentCount: components.length,
                messageStatus: messageStatus || 'accepted',
                headerMediaUrl: headerMediaUrl || null,
            }
        });
    } catch (err: any) {
        console.error('[WHATSAPP TEST SEND] Unexpected Error:', err);
        return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
}
