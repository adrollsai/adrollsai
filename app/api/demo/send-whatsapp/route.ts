import { NextResponse } from 'next/server';
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js';

const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const {
            prospectPhone,
            prospectName = 'Prospect',
            companyName = 'Bioque Estates',
            projectTitle = 'Prime Property Showcase',
            slotTime = 'Tomorrow at 11:30 AM IST',
            callerName = 'Priya (Executive Advisor)',
            type = 'lead_welcome' // 'lead_welcome' | 'appointment_booked'
        } = body;

        if (!prospectPhone || typeof prospectPhone !== 'string') {
            return NextResponse.json({ error: 'Valid prospect phone number is required.' }, { status: 400 });
        }

        // Clean & format destination phone number (digits with 91 prefix for India)
        let cleanDigits = prospectPhone.replace(/\D/g, '');
        if (cleanDigits.startsWith('00')) cleanDigits = cleanDigits.slice(2);
        if (cleanDigits.length === 10) {
            cleanDigits = '91' + cleanDigits;
        } else if (cleanDigits.length === 11 && cleanDigits.startsWith('0')) {
            cleanDigits = '91' + cleanDigits.slice(1);
        } else if (cleanDigits.length === 12 && cleanDigits.startsWith('91')) {
            // Already 91...
        }

        // Dynamically fetch super admin account (rchopra489@gmail.com) WABA credentials from Supabase
        const { data: superAdminProfile, error: profileErr } = await supabaseAdmin
            .from('profiles')
            .select('id, email, whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_access_token, facebook_token')
            .eq('email', 'rchopra489@gmail.com')
            .maybeSingle();

        if (profileErr) {
            console.error('[Demo WhatsApp] Failed to fetch super admin profile:', profileErr);
        }

        // Prioritize facebook_token (full business & whatsapp_business_messaging scopes), then whatsapp_access_token, then env fallback
        const candidateTokens = [
            superAdminProfile?.facebook_token,
            superAdminProfile?.whatsapp_access_token,
            process.env.DEV_WHATSAPP_ACCESS_TOKEN
        ].filter(Boolean) as string[];

        const phoneId = superAdminProfile?.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID || '1140952692437292';

        if (candidateTokens.length === 0) {
            console.error('[Demo WhatsApp] No WhatsApp access token found for rchopra489@gmail.com');
            return NextResponse.json({ error: 'WhatsApp API credentials not configured.' }, { status: 500 });
        }

        let templatePayload: any;
        let templateName: string;
        let sampleText: string;

        if (type === 'appointment_booked') {
            templateName = 'booking_confirmation_generic';
            sampleText = `Hi ${prospectName}, your appointment has been confirmed for ${slotTime} with ${callerName} from ${companyName}. We look forward to connecting with you!`;
            templatePayload = {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: cleanDigits,
                type: 'template',
                template: {
                    name: 'booking_confirmation_generic',
                    language: { code: 'en_US' },
                    components: [
                        {
                            type: 'body',
                            parameters: [
                                { type: 'text', text: prospectName || 'Valued Client' },
                                { type: 'text', text: slotTime },
                                { type: 'text', text: callerName },
                                { type: 'text', text: companyName }
                            ]
                        }
                    ]
                }
            };
        } else {
            templateName = 'auto_lead_welcome';
            sampleText = `Hi ${prospectName}, thank you for reaching out to ${companyName}. We have received your inquiry regarding ${projectTitle} and our team will get back to you shortly!`;
            templatePayload = {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: cleanDigits,
                type: 'template',
                template: {
                    name: 'auto_lead_welcome',
                    language: { code: 'en_US' },
                    components: [
                        {
                            type: 'body',
                            parameters: [
                                { type: 'text', text: prospectName || 'Valued Client' },
                                { type: 'text', text: companyName },
                                { type: 'text', text: projectTitle }
                            ]
                        }
                    ]
                }
            };
        }

        console.log(`[Demo WhatsApp] Dispatching real ${templateName} template to +${cleanDigits} using phoneId ${phoneId} from rchopra489@gmail.com WABA...`);

        let sendSuccess = false;
        let lastError: any = null;
        let messageId: string | null = null;
        let usedTokenPrefix = '';

        // Iterate through candidate tokens until success
        for (const token of candidateTokens) {
            try {
                const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
                const res = await fetch(metaUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(templatePayload)
                });

                const data = await res.json();
                console.log(`[Demo WhatsApp] Meta API Response for token prefix ${token.substring(0, 10)}:`, data);

                if (res.ok && data.messages?.[0]?.id) {
                    sendSuccess = true;
                    messageId = data.messages[0].id;
                    usedTokenPrefix = token.substring(0, 15);
                    break;
                } else {
                    lastError = data.error;
                    console.warn(`[Demo WhatsApp] Candidate token failed (${data.error?.message || 'Unknown'}). Trying next candidate...`);
                }
            } catch (callErr: any) {
                lastError = callErr;
            }
        }

        if (!sendSuccess) {
            console.error('[Demo WhatsApp] All candidate tokens failed:', lastError);
            return NextResponse.json({
                error: lastError?.message || 'Meta WhatsApp delivery failed.',
                details: lastError
            }, { status: 400 });
        }

        // Log message and update/create chat thread for rchopra489@gmail.com
        if (superAdminProfile?.id) {
            try {
                const adminUserId = superAdminProfile.id;
                const phoneDigits = cleanDigits.slice(-10);

                let { data: chat } = await supabaseAdmin
                    .from('whatsapp_chats')
                    .select('id')
                    .eq('user_id', adminUserId)
                    .or(`recipient_phone.eq.${cleanDigits},recipient_phone.eq.+${cleanDigits},recipient_phone.ilike.%${phoneDigits}%`)
                    .order('updated_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (!chat) {
                    const { data: newChat } = await supabaseAdmin
                        .from('whatsapp_chats')
                        .insert({
                            user_id: adminUserId,
                            recipient_name: prospectName,
                            recipient_phone: `+${cleanDigits}`,
                            last_message_text: `[${templateName}] ${sampleText}`,
                            unread_count: 0,
                            updated_at: new Date().toISOString()
                        })
                        .select('id')
                        .single();
                    chat = newChat;
                } else {
                    await supabaseAdmin
                        .from('whatsapp_chats')
                        .update({
                            recipient_name: prospectName,
                            last_message_text: `[${templateName}] ${sampleText}`,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', chat.id);
                }

                if (chat?.id) {
                    await supabaseAdmin.from('whatsapp_messages').insert({
                        chat_id: chat.id,
                        direction: 'outbound',
                        message_text: sampleText,
                        status: 'sent',
                        meta_message_id: messageId,
                        created_at: new Date().toISOString()
                    });
                }
            } catch (logErr) {
                console.warn('[Demo WhatsApp] Failed to log chat message to Supabase:', logErr);
            }
        }

        return NextResponse.json({
            success: true,
            recipient: cleanDigits,
            messageId,
            templateName,
            sampleText,
            tokenPrefix: usedTokenPrefix
        });

    } catch (err: any) {
        console.error('[Demo WhatsApp] Unexpected error:', err);
        return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
}
