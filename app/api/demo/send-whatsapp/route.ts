import { NextResponse } from 'next/server';
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js';

const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

const NOBOGENT_PHONE_ID = process.env.DEV_WHATSAPP_PHONE_ID || '1140952692437292';
const NOBOGENT_TOKEN = process.env.DEV_WHATSAPP_ACCESS_TOKEN;

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

        if (!NOBOGENT_TOKEN) {
            return NextResponse.json({ error: 'WhatsApp API credentials not configured.' }, { status: 500 });
        }

        // Clean & format destination phone number (digits with 91 prefix for India)
        let cleanDigits = prospectPhone.replace(/\D/g, '');
        if (cleanDigits.startsWith('00')) cleanDigits = cleanDigits.slice(2);
        if (cleanDigits.length === 10) {
            cleanDigits = '91' + cleanDigits;
        } else if (cleanDigits.length === 11 && cleanDigits.startsWith('0')) {
            cleanDigits = '91' + cleanDigits.slice(1);
        } else if (cleanDigits.length === 12 && cleanDigits.startsWith('91')) {
            // Valid
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

        console.log(`[Demo WhatsApp] Dispatching real ${templateName} template to +${cleanDigits}...`);

        const metaUrl = `https://graph.facebook.com/v20.0/${NOBOGENT_PHONE_ID}/messages`;
        const res = await fetch(metaUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${NOBOGENT_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(templatePayload)
        });

        const data = await res.json();
        console.log(`[Demo WhatsApp] Meta API Response for ${templateName}:`, data);

        if (!res.ok || data.error) {
            console.error('[Demo WhatsApp] Failed to send template:', data.error);
            return NextResponse.json({
                error: data.error?.message || 'Meta WhatsApp delivery failed.',
                details: data.error
            }, { status: 400 });
        }

        const messageId = data.messages?.[0]?.id;

        return NextResponse.json({
            success: true,
            recipient: cleanDigits,
            messageId,
            templateName,
            sampleText
        });

    } catch (err: any) {
        console.error('[Demo WhatsApp] Unexpected error:', err);
        return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
}
