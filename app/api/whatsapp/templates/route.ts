import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

// Seeded local template list fallback for seamless developer sandbox experience
const FALLBACK_TEMPLATES = [
    {
        name: 'hello_world',
        status: 'APPROVED',
        category: 'UTILITY',
        language: 'en_US',
        components: [
            { type: 'BODY', text: 'Hello! This is a standard welcome message from Meta Sandbox.' }
        ]
    }
]

export async function GET(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const url = new URL(req.url)
        const impersonateId = url.searchParams.get('impersonate')

        // Resolve effective user ID (support impersonation for super_admin/agency)
        let effectiveUserId = user.id
        if (impersonateId && impersonateId !== user.id) {
            const { data: authProfile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', user.id)
                .single()
            const authRole = authProfile?.role?.toLowerCase() || ''
            if (['super_admin', 'agency', 'admin'].includes(authRole)) {
                effectiveUserId = impersonateId
            }
        }

        // Fetch WhatsApp credentials
        const { data: profile } = await supabase
            .from('profiles')
            .select('whatsapp_access_token, whatsapp_waba_id, facebook_token, email')
            .eq('id', effectiveUserId)
            .single()

        const isMasterDefaultUser = profile?.email === 'rchopra489@gmail.com' || profile?.email === 'infobluesquareinfra@gmail.com'
        const whatsappToken = profile?.whatsapp_access_token || profile?.facebook_token || (isMasterDefaultUser ? process.env.DEV_WHATSAPP_ACCESS_TOKEN : null)
        const whatsappWabaId = profile?.whatsapp_waba_id || (isMasterDefaultUser ? process.env.DEV_WHATSAPP_WABA_ID : null)

        if (!whatsappToken || !whatsappWabaId) {
            // No credentials = return standard templates so setup wizard works
            return NextResponse.json({ success: true, templates: FALLBACK_TEMPLATES, source: 'mock_unconfigured' })
        }

        const metaUrl = `https://graph.facebook.com/v20.0/${whatsappWabaId}/message_templates?limit=100`
        
        try {
            const metaRes = await fetch(metaUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${whatsappToken}`
                }
            })

            const metaData = await metaRes.json()

            if (metaData.error) {
                console.warn('[TEMPLATES API] Meta fetch failed (likely token expired), returning fallbacks:', metaData.error)
                return NextResponse.json({ 
                    success: true, 
                    templates: FALLBACK_TEMPLATES, 
                    source: 'fallback_meta_error',
                    warning: 'Using offline templates fallback: ' + (metaData.error.message || 'Token expired.')
                })
            }

            // Successfully fetched from Meta, return mapped list
            const templates = (metaData.data || []).map((t: any) => ({
                name: t.name,
                status: t.status || 'PENDING',
                category: t.category,
                language: t.language,
                components: t.components || []
            }))

            // Merge local default ones if not present in Meta list (for sandbox testing compatibility)
            const wabaNames = new Set(templates.map((t: any) => t.name))
            FALLBACK_TEMPLATES.forEach(ft => {
                if (!wabaNames.has(ft.name)) {
                    templates.push(ft)
                }
            })

            return NextResponse.json({ success: true, templates, source: 'meta' })
        } catch (fetchErr: any) {
            console.error('[TEMPLATES API] Unexpected fetch exception:', fetchErr)
            return NextResponse.json({ success: true, templates: FALLBACK_TEMPLATES, source: 'fallback_exception' })
        }
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}

export async function POST(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const body = await req.json()
        const { 
            name, 
            category, 
            bodyText, 
            headerType, 
            headerText,
            buttonsType,
            quickReplyButtons,
            ctaUrlText,
            ctaUrl,
            ctaPhoneText,
            ctaPhone,
            buttons 
        } = body

        if (!name || !category || !bodyText) {
            return NextResponse.json({ error: 'Missing required template configurations (name, category, bodyText)' }, { status: 400 })
        }

        // Validate template name formatting (Meta only allows lowercase, numbers and underscores)
        const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')
        if (!cleanName) {
            return NextResponse.json({ error: 'Invalid template name. Use alphanumeric characters and underscores only.' }, { status: 400 })
        }

        // Fetch credentials
        const { data: profile } = await supabase
            .from('profiles')
            .select('whatsapp_access_token, whatsapp_waba_id, facebook_token, email')
            .eq('id', user.id)
            .single()

        const isMasterDefaultUser = profile?.email === 'rchopra489@gmail.com' || profile?.email === 'infobluesquareinfra@gmail.com'
        const whatsappToken = profile?.whatsapp_access_token || profile?.facebook_token || (isMasterDefaultUser ? process.env.DEV_WHATSAPP_ACCESS_TOKEN : null)
        const whatsappWabaId = profile?.whatsapp_waba_id || (isMasterDefaultUser ? process.env.DEV_WHATSAPP_WABA_ID : null)

        if (!whatsappToken || !whatsappWabaId) {
            return NextResponse.json({ 
                error: 'WhatsApp integration not configured. Please connect your credentials first.' 
            }, { status: 400 })
        }

        const components: any[] = []

        // 1. HEADER COMPONENT
        if (headerType && headerType !== 'NONE') {
            const hType = headerType.toUpperCase()
            if (hType === 'TEXT' && headerText) {
                components.push({
                    type: 'HEADER',
                    format: 'TEXT',
                    text: headerText.trim()
                })
            } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(hType)) {
                const headerComp: any = {
                    type: 'HEADER',
                    format: hType
                }
                // Attach sample example URL required by Meta for media headers
                if (hType === 'IMAGE') {
                    headerComp.example = {
                        header_handle: ['https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/2f62a259-f23b-48ee-a920-c436f36eaa4b/1778143153926.png']
                    }
                } else if (hType === 'VIDEO') {
                    headerComp.example = {
                        header_handle: ['https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/library/bc63c065-9bcc-4793-bedc-f0960406425b/1785562776349-reelvideo.mp4']
                    }
                }
                components.push(headerComp)
            }
        }

        // 2. BODY COMPONENT
        const bodyComp: any = {
            type: 'BODY',
            text: bodyText
        }

        // If bodyText contains variables like {{1}}, {{2}}, extract and inject required Meta examples
        const matches = bodyText.match(/\{\{(\d+)\}\}/g)
        if (matches && matches.length > 0) {
            const uniqueIndices = Array.from<number>(new Set(matches.map((m: string) => parseInt(m.replace(/\D/g, '')))))
                .sort((a, b) => a - b)
            const examplesList = uniqueIndices.map(index => `Sample ${index}`)
            bodyComp.example = {
                body_text: [examplesList]
            }
        }
        components.push(bodyComp)

        // 3. BUTTONS COMPONENT
        const effectiveBtnType = buttonsType || (Array.isArray(buttons) && buttons.length > 0 ? 'QUICK_REPLY' : 'NONE')
        
        if (effectiveBtnType === 'QUICK_REPLY') {
            const replyList = Array.isArray(quickReplyButtons) && quickReplyButtons.length > 0
                ? quickReplyButtons
                : buttons
            
            const validReplies = (replyList || [])
                .map((b: any) => typeof b === 'string' ? b.trim() : b.text?.trim())
                .filter((b: string) => !!b)

            if (validReplies.length > 0) {
                components.push({
                    type: 'BUTTONS',
                    buttons: validReplies.slice(0, 3).map((txt: string) => ({
                        type: 'QUICK_REPLY',
                        text: txt
                    }))
                })
            }
        } else if (effectiveBtnType === 'CALL_TO_ACTION') {
            const ctaButtonsList: any[] = []
            
            if (ctaUrlText && ctaUrl) {
                let cleanUrl = ctaUrl.trim()
                if (!cleanUrl.startsWith('http')) cleanUrl = `https://${cleanUrl}`
                ctaButtonsList.push({
                    type: 'URL',
                    text: ctaUrlText.trim(),
                    url: cleanUrl
                })
            }

            if (ctaPhoneText && ctaPhone) {
                let cleanPhone = ctaPhone.trim().replace(/[^\d+]/g, '')
                if (!cleanPhone.startsWith('+')) cleanPhone = `+${cleanPhone}`
                ctaButtonsList.push({
                    type: 'PHONE_NUMBER',
                    text: ctaPhoneText.trim(),
                    phone_number: cleanPhone
                })
            }

            if (ctaButtonsList.length > 0) {
                components.push({
                    type: 'BUTTONS',
                    buttons: ctaButtonsList
                })
            }
        }

        // Structure standard Meta message template creation payload
        const templatePayload: any = {
            name: cleanName,
            category: category.toUpperCase(), // 'MARKETING' or 'UTILITY'
            language: 'en_US',
            components
        }


        const metaUrl = `https://graph.facebook.com/v20.0/${whatsappWabaId}/message_templates`
        const metaRes = await fetch(metaUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${whatsappToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(templatePayload)
        })

        const metaData = await metaRes.json()

        if (metaData.error) {
            console.error('[TEMPLATES API] Meta Submit Error:', metaData.error)
            return NextResponse.json({ 
                error: metaData.error.message || 'Meta API rejected the template submission.',
                details: metaData.error
            }, { status: 400 })
        }

        return NextResponse.json({ 
            success: true, 
            message: 'Template submitted successfully for Meta approval!',
            templateId: metaData.id 
        })

    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
