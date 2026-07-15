import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

const SEED_TEMPLATES = [
    {
        name: 'auto_lead_welcome',
        category: 'UTILITY',
        bodyText: 'Hi {{1}}, thank you for reaching out to {{2}}. We have received your inquiry regarding {{3}} and our team will get back to you shortly. In the meantime, if you have any questions, feel free to reply directly to this message!',
        example: {
            body_text: [['John', 'Business Name', 'inquiry']]
        }
    },
    {
        name: 'auto_drip_followup_24h',
        category: 'UTILITY',
        bodyText: 'Hi {{1}}, just checking in on your request with {{2}} from yesterday. Do you have any questions or would you like to schedule a quick call to discuss how we can help you?',
        example: {
            body_text: [['John', 'Business Name']]
        }
    },
    {
        name: 'auto_drip_followup_48h',
        category: 'UTILITY',
        bodyText: 'Hello {{1}}, we\'d love to help you get started at {{2}}. Let us know if you\'d like to book a demo slot or speak with one of our representatives.',
        example: {
            body_text: [['John', 'Business Name']]
        }
    },
    {
        name: 'auto_reminder_24h',
        category: 'UTILITY',
        bodyText: 'Hi {{1}}, this is a quick reminder of your scheduled appointment with {{2}} tomorrow, {{3}} at {{4}}. We look forward to speaking with you!',
        example: {
            body_text: [['John', 'Business Name', 'tomorrow', '2:00 PM']]
        }
    },
    {
        name: 'auto_reminder_4h',
        category: 'UTILITY',
        bodyText: 'Hi {{1}}, looking forward to our appointment today in 4 hours (at {{2}}). Please let us know if you need to reschedule.',
        example: {
            body_text: [['John', '2:00 PM']]
        }
    },
    {
        name: 'auto_reminder_1h',
        category: 'UTILITY',
        bodyText: 'Hi {{1}}, our meeting starts in 1 hour at {{2}}. We look forward to connecting with you shortly!',
        example: {
            body_text: [['John', '2:00 PM']]
        }
    },
    {
        name: 'auto_reminder_15m',
        category: 'UTILITY',
        bodyText: 'Hi {{1}}, we are starting in 15 minutes! Please click the link to join: {{2}}.',
        example: {
            body_text: [['John', 'https://meet.google.com/abc']]
        }
    }
]

export async function POST(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const { data: authProfile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
        if (!['super_admin', 'agency', 'admin'].includes(authProfile?.role || '')) {
            return NextResponse.json({ error: 'Only admins are authorized to manage templates.' }, { status: 403 })
        }

        const body = await req.json().catch(() => ({}))
        const targetUserId = body.userId || user.id

        // Ensure current user is authorized to trigger for this targetUserId if overridden
        if (targetUserId !== user.id) {
            // Already checked role above is at least admin, so they are authorized
        }

        // Fetch WhatsApp credentials
        const { data: profile } = await supabase
            .from('profiles')
            .select('whatsapp_access_token, whatsapp_waba_id, facebook_token, email')
            .eq('id', targetUserId)
            .single()

        const isMasterDefaultUser = profile?.email === 'rchopra489@gmail.com' || profile?.email === 'infobluesquareinfra@gmail.com'
        const whatsappToken = profile?.whatsapp_access_token || profile?.facebook_token || (isMasterDefaultUser ? process.env.DEV_WHATSAPP_ACCESS_TOKEN : null)
        const whatsappWabaId = profile?.whatsapp_waba_id || (isMasterDefaultUser ? process.env.DEV_WHATSAPP_WABA_ID : null)

        if (!whatsappToken || !whatsappWabaId) {
            return NextResponse.json({ error: 'WhatsApp not configured for target user.' }, { status: 400 })
        }

        // 1. Fetch current templates from Meta to prevent duplicates
        const getMetaUrl = `https://graph.facebook.com/v20.0/${whatsappWabaId}/message_templates?limit=1000`
        const getRes = await fetch(getMetaUrl, {
            headers: { 'Authorization': `Bearer ${whatsappToken}` }
        })
        const getParsed = await getRes.json()
        const existingNames = new Set((getParsed.data || []).map((t: any) => t.name.toLowerCase()))

        // 2. Identify templates that need to be created
        const templatesToSubmit = SEED_TEMPLATES.filter(t => !existingNames.has(t.name.toLowerCase()))
        
        console.log(`[Auto-Seed] Found ${templatesToSubmit.length} templates that need to be registered out of ${SEED_TEMPLATES.length} total.`);

        const results = []
        const postMetaUrl = `https://graph.facebook.com/v20.0/${whatsappWabaId}/message_templates`

        for (const t of templatesToSubmit) {
            const templatePayload = {
                name: t.name,
                category: t.category,
                language: 'en_US',
                components: [
                    {
                        type: 'BODY',
                        text: t.bodyText,
                        example: t.example
                    }
                ]
            }

            try {
                const submitRes = await fetch(postMetaUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${whatsappToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(templatePayload)
                })

                const submitData = await submitRes.json()
                if (submitData.error) {
                    console.error(`[Auto-Seed] Error creating ${t.name}:`, submitData.error)
                    results.push({ name: t.name, success: false, error: submitData.error.message || 'Meta rejection' })
                } else {
                    results.push({ name: t.name, success: true, id: submitData.id })
                }
            } catch (err: any) {
                console.error(`[Auto-Seed] Exception creating ${t.name}:`, err)
                results.push({ name: t.name, success: false, error: err.message || 'Fetch Exception' })
            }
        }

        return NextResponse.json({ 
            success: true, 
            total: SEED_TEMPLATES.length, 
            submitted: templatesToSubmit.length, 
            results 
        })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
