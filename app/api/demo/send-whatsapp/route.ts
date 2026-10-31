import { NextResponse } from 'next/server';
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js';

const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

// Fallback high-resolution architectural photo for WhatsApp template header
const FALLBACK_SHOWCASE_IMAGE = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/reference-creatives/dubai/pinterest_pin_1793111079523_0.jpg';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const {
            prospectPhone,
            prospectName = 'Valued Client',
            companyName = 'Apex Luxury Living',
            projectTitle = 'The Grand Crest Luxury Residences',
            creativeUrl,
            imageUrl,
            type = 'creative_preview'
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
            // Already standard 91...
        }

        // Fetch super admin profile (rchopra489@gmail.com) credentials from Supabase
        const { data: superAdminProfile, error: profileErr } = await supabaseAdmin
            .from('profiles')
            .select('id, email, whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_access_token, facebook_token')
            .eq('email', 'rchopra489@gmail.com')
            .maybeSingle();

        if (profileErr) {
            console.error('[Demo WhatsApp] Failed to fetch super admin profile:', profileErr);
        }

        const candidateTokens = [
            superAdminProfile?.facebook_token,
            superAdminProfile?.whatsapp_access_token,
            process.env.DEV_WHATSAPP_ACCESS_TOKEN
        ].filter(Boolean) as string[];

        // Verified Nobogent WhatsApp Business Phone Number (+91 98771 61216, verified_name: 'Nobogent')
        const NOBOGENT_OFFICIAL_PHONE_ID = '1185499271314063';
        const phoneId = superAdminProfile?.whatsapp_phone_number_id === '1140952692437292' 
            ? NOBOGENT_OFFICIAL_PHONE_ID 
            : (superAdminProfile?.whatsapp_phone_number_id || NOBOGENT_OFFICIAL_PHONE_ID);

        if (candidateTokens.length === 0) {
            console.error('[Demo WhatsApp] No WhatsApp access token found.');
            return NextResponse.json({ error: 'WhatsApp API credentials not configured.' }, { status: 500 });
        }

        // Resolve creative/showcase image: generated creative > uploaded image > fallback luxury photo
        let effectiveImageUrl = creativeUrl || imageUrl;
        if (!effectiveImageUrl || typeof effectiveImageUrl !== 'string' || !effectiveImageUrl.startsWith('http')) {
            effectiveImageUrl = FALLBACK_SHOWCASE_IMAGE;
        }

        console.log(`[Demo WhatsApp] Target phone: +${cleanDigits}, Business: "${companyName}", Project: "${projectTitle}", Image: "${effectiveImageUrl.slice(0, 70)}..."`);

        // We prepare template candidate payloads:
        // 1. booking_confirmation_prospect (APPROVED with IMAGE header on Nobogent phone, verified delivery)
        // 2. generic_business_update_showcase (Newly approved by Meta with IMAGE header)
        // 3. auto_lead_welcome (APPROVED utility fallback)
        const templatesToAttempt = [
            {
                name: 'booking_confirmation_prospect',
                language: { code: 'en_US' },
                components: [
                    {
                        type: 'header',
                        parameters: [
                            {
                                type: 'image',
                                image: { link: effectiveImageUrl }
                            }
                        ]
                    },
                    {
                        type: 'body',
                        parameters: [
                            { type: 'text', text: prospectName || 'Valued Client' },
                            { type: 'text', text: 'VIP Walkthrough & Preview' },
                            { type: 'text', text: projectTitle || 'Luxury Showcase' },
                            { type: 'text', text: companyName || 'Apex Luxury Living' }
                        ]
                    }
                ],
                sampleText: `Hi ${prospectName}, your appointment is confirmed for VIP Walkthrough & Preview with ${projectTitle} from ${companyName}. We look forward to connecting with you!`
            },
            {
                name: 'generic_business_update_showcase',
                language: { code: 'en_US' },
                components: [
                    {
                        type: 'header',
                        parameters: [
                            {
                                type: 'image',
                                image: { link: effectiveImageUrl }
                            }
                        ]
                    },
                    {
                        type: 'body',
                        parameters: [
                            { type: 'text', text: prospectName || 'Valued Client' },
                            { type: 'text', text: `${projectTitle} by ${companyName}` }
                        ]
                    }
                ],
                sampleText: `Hello ${prospectName}, here is the exclusive update and latest showcase for ${projectTitle} by ${companyName}. We are delighted to share these details with you. If you have any questions, feel free to reply!`
            },
            {
                name: 'auto_lead_welcome',
                language: { code: 'en_US' },
                components: [
                    {
                        type: 'body',
                        parameters: [
                            { type: 'text', text: prospectName || 'Valued Client' },
                            { type: 'text', text: companyName || 'Apex Luxury Living' },
                            { type: 'text', text: projectTitle || 'Luxury Residences' }
                        ]
                    }
                ],
                sampleText: `Hi ${prospectName}, thank you for reaching out to ${companyName}. We have received your inquiry regarding ${projectTitle} and our team will get back to you shortly!`
            }
        ];

        let sendSuccess = false;
        let lastError: any = null;
        let successfulMessageId: string | null = null;
        let successfulTemplateName = '';
        let successfulSampleText = '';
        let usedTokenPrefix = '';

        // Try candidate templates across candidate tokens
        for (const tmpl of templatesToAttempt) {
            if (sendSuccess) break;

            const templatePayload = {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: cleanDigits,
                type: 'template',
                template: {
                    name: tmpl.name,
                    language: tmpl.language,
                    components: tmpl.components
                }
            };

            for (const token of candidateTokens) {
                try {
                    console.log(`[Demo WhatsApp] Attempting template "${tmpl.name}" to +${cleanDigits}...`);
                    const metaUrl = `https://graph.facebook.com/v21.0/${phoneId}/messages`;
                    const res = await fetch(metaUrl, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(templatePayload)
                    });

                    const data = await res.json();
                    console.log(`[Demo WhatsApp] Meta response for "${tmpl.name}":`, JSON.stringify(data));

                    if (res.ok && data.messages?.[0]?.id) {
                        sendSuccess = true;
                        successfulMessageId = data.messages[0].id;
                        successfulTemplateName = tmpl.name;
                        successfulSampleText = tmpl.sampleText;
                        usedTokenPrefix = token.substring(0, 15);
                        break;
                    } else {
                        lastError = data.error || { message: `HTTP ${res.status}: ${JSON.stringify(data)}` };
                        console.warn(`[Demo WhatsApp] Template "${tmpl.name}" failed: ${data.error?.message || 'Unknown error'}`);
                    }
                } catch (callErr: any) {
                    lastError = callErr;
                    console.warn(`[Demo WhatsApp] Network error for "${tmpl.name}":`, callErr.message);
                }
            }
        }

        if (!sendSuccess) {
            console.error('[Demo WhatsApp] All candidate templates failed:', lastError);
            return NextResponse.json({
                error: lastError?.message || 'Meta WhatsApp delivery failed.',
                details: lastError
            }, { status: 400 });
        }

        // Log message and update/create chat thread in Supabase for tracking
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
                            last_message_text: `[${successfulTemplateName}] ${successfulSampleText}`,
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
                            last_message_text: `[${successfulTemplateName}] ${successfulSampleText}`,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', chat.id);
                }

                if (chat?.id) {
                    await supabaseAdmin.from('whatsapp_messages').insert({
                        chat_id: chat.id,
                        direction: 'outbound',
                        message_text: successfulSampleText,
                        media_url: effectiveImageUrl,
                        status: 'sent',
                        meta_message_id: successfulMessageId,
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
            messageId: successfulMessageId,
            templateName: successfulTemplateName,
            imageUrl: effectiveImageUrl,
            sampleText: successfulSampleText,
            tokenPrefix: usedTokenPrefix
        });

    } catch (err: any) {
        console.error('[Demo WhatsApp] Unexpected error:', err);
        return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
}
