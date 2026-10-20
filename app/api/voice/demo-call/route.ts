import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { triggerVobizOutboundCall } from '@/utils/vobiz-helper'

const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
)

const BIOQUE_USER_ID = '68b55a31-a16d-454d-a20f-11adabf590b0'
const BIOQUE_CALLER_NUMBER = '+917965480539'

export async function POST(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized. Please sign in.' }, { status: 401 })
        }

        // Verify Super Admin privileges
        const { data: callerProfile } = await supabaseAdmin
            .from('profiles')
            .select('role, email')
            .eq('id', user.id)
            .single()

        const isSuperAdmin = callerProfile?.role === 'super_admin' || callerProfile?.email === 'rchopra489@gmail.com'
        if (!isSuperAdmin) {
            return NextResponse.json({ error: 'Forbidden. This module is restricted to Nobogent Super Admin.' }, { status: 403 })
        }

        const body = await req.json()
        const {
            prospectPhone,
            prospectName = 'Prospect',
            voiceName = 'Nova',
            templateId = 'amritha_vana',
            templateTitle = 'Amritha Vana Luxury Farm Retreats',
            businessName = 'Bioque Estates International',
            customPrompt
        } = body

        if (!prospectPhone || typeof prospectPhone !== 'string' || prospectPhone.trim().length < 8) {
            return NextResponse.json({ error: 'A valid prospect phone number is required.' }, { status: 400 })
        }

        if (!customPrompt || typeof customPrompt !== 'string' || customPrompt.trim().length < 20) {
            return NextResponse.json({ error: 'Prompt instruction is too short or empty.' }, { status: 400 })
        }

        // Clean & normalize destination phone number (+91 E.164)
        let cleanPhone = prospectPhone.replace(/\D/g, '')
        if (!cleanPhone.startsWith('+')) {
            if (cleanPhone.length === 10) {
                cleanPhone = '+91' + cleanPhone
            } else if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) {
                cleanPhone = '+' + cleanPhone
            } else {
                cleanPhone = '+' + cleanPhone
            }
        }

        console.log(`[AI CALL DEMO] Triggering demo call to ${cleanPhone} (${prospectName}) from Bioque Estates line (${BIOQUE_CALLER_NUMBER})...`)

        // 1. Extract greeting directly from customPrompt if present
        let extractedGreeting: string | null = null;
        const directGreetingMatch = customPrompt.match(/GREETING:\s*["']([^"'\r\n]+)["']/i);
        if (directGreetingMatch && directGreetingMatch[1]) {
            extractedGreeting = directGreetingMatch[1];
        } else {
            const altGreetingMatch = customPrompt.match(/(?:Opening Greeting|First Message|Greeting)\s*(?::|-)\s*["']([^"'\r\n]+)["']/i);
            if (altGreetingMatch && altGreetingMatch[1]) {
                extractedGreeting = altGreetingMatch[1];
            }
        }

        if (extractedGreeting) {
            extractedGreeting = extractedGreeting
                .replace(/\{name\}/gi, prospectName)
                .replace(/\{lead_name\}/gi, prospectName)
                .replace(/\{business_name\}/gi, businessName)
                .replace(/\{company_name\}/gi, businessName)
                .trim();
        }

        const promptLower = customPrompt.toLowerCase();
        const greetingLower = (extractedGreeting || '').toLowerCase();

        const isGreetingEnglish = greetingLower.startsWith('hello') || greetingLower.startsWith('hi ') || greetingLower.includes('how are you') || greetingLower.includes('calling from');
        const isGreetingKannada = greetingLower.startsWith('namaskara') || greetingLower.includes('hegiddira');
        const isGreetingHindi = greetingLower.includes('kaise hain') || greetingLower.includes('kaise ho');

        const isExplicitHinglish = !isGreetingEnglish && (promptLower.includes('default language: hinglish') || promptLower.includes('default language: hindi') || isGreetingHindi);
        const isKannada = isGreetingKannada || (!isGreetingEnglish && (promptLower.includes('kannada') || customPrompt.includes('ಕನ್ನಡ')));
        const isIndianEnglish = isGreetingEnglish || (!isExplicitHinglish && !isKannada);

        let initialGreeting = extractedGreeting;
        if (!initialGreeting) {
            if (isKannada) {
                initialGreeting = `Namaskara ${prospectName} avare, hegiddira? Naanu ${businessName} inda call maadtha iddini. Neevu Facebook alli inquiry submit maadidri. Ondu nimisha maathadbahuda?`;
            } else if (isExplicitHinglish) {
                initialGreeting = `Hi ${prospectName} ji, kaise hain aap? Main ${businessName} se call kar rahi hoon aapki inquiry ke regarding.`;
            } else {
                initialGreeting = `Hello ${prospectName}, I am Sahana calling from ${businessName} regarding your inquiry on Facebook. Do you have a quick minute to speak?`;
            }
        }

        const detectedLanguage = isIndianEnglish ? 'english' : (isKannada ? 'kannada' : 'hinglish');
        console.log(`[AI CALL DEMO] Configured Greeting: "${initialGreeting}" (Language: ${detectedLanguage})`);

        // 1. Create a dedicated demo voice campaign for prompt & voice routing
        const campaignName = `AI Call Demo - ${prospectName} (${templateTitle})`
        const { data: campaign, error: campErr } = await supabaseAdmin
            .from('voice_campaigns')
            .insert({
                user_id: BIOQUE_USER_ID,
                name: campaignName,
                audience_filter: {
                    voice_name: voiceName,
                    is_demo: true,
                    language: isIndianEnglish ? 'english' : (isKannada ? 'kannada' : 'hinglish'),
                    greeting: initialGreeting
                },
                custom_prompt: customPrompt,
                status: 'running'
            })
            .select()
            .single()

        if (campErr) {
            console.error('[AI CALL DEMO] Error creating demo voice campaign:', campErr)
        }

        // 2. Create the prospect lead record
        // CRITICAL: We tag skip_credit_deduction and is_demo_call so Bioque account is NOT charged!
        const { data: lead, error: leadErr } = await supabaseAdmin
            .from('leads')
            .insert({
                user_id: BIOQUE_USER_ID,
                name: prospectName,
                phone: cleanPhone,
                source: 'AI Call Demo',
                pipeline_stage: 'New Lead',
                status: 'New Lead',
                voice_campaign_id: campaign?.id || null,
                voice_call_status: 'calling',
                notes: `[🎙️ AI Call Demo - ${templateTitle}]\nBusiness: ${businessName}\nSelected Voice: ${voiceName}\nTriggered by Nobogent Super Admin: ${callerProfile.email}`,
                custom_fields: {
                    is_demo_call: true,
                    is_test_call: true,
                    skip_credit_deduction: true, // EXPLICIT PROTECTION: ZERO CREDITS BILLED TO BIOQUE
                    allow_after_hours: true,     // ALLOWS DEMO TESTING ANY TIME 24x7
                    demo_template_id: templateId,
                    demo_template_title: templateTitle,
                    demo_business_name: businessName,
                    demo_voice_name: voiceName,
                    demo_prompt: customPrompt,
                    triggered_by_admin: callerProfile.email,
                    triggered_at: new Date().toISOString(),
                    ...(isKannada || templateId === 'amritha_vana' ? {
                        'primary_interest': 'Luxury Weekend Farmhouse with Dome',
                        'preferred_configuration_and_budget': '₹50 Lakhs (6,000 Sq.Ft Plot + Dome Launch Offer)',
                        'site_visit_timeline': 'This Coming Weekend',
                        meta_ad_origin: {
                            campaign_name: 'Amritha Vana Mysore - Luxury Farm Retreats',
                            product_name: 'Amritha Vana Luxury Farm Plot + Dome (₹50L Launch Offer)',
                            ad_name: 'Ad 1 - Luxury Glamping & Dome Retreat'
                        }
                    } : {})
                }
            })
            .select()
            .single()

        if (leadErr || !lead) {
            console.error('[AI CALL DEMO] Error creating lead:', leadErr)
            return NextResponse.json({ error: 'Failed to initialize prospect record: ' + (leadErr?.message || 'Unknown') }, { status: 500 })
        }

        // 3. Initiate the call via Vobiz using Bioque Estates virtual caller ID
        const vobizRes = await triggerVobizOutboundCall(supabaseAdmin, {
            leadId: lead.id,
            profileId: BIOQUE_USER_ID,
            toPhone: cleanPhone,
            fromPhone: BIOQUE_CALLER_NUMBER,
            campaignId: campaign?.id,
            allowAfterHours: true,
            skipCreditCheck: true,
            voiceName: voiceName
        })

        if (!vobizRes.success && !vobizRes.scheduled) {
            console.error('[AI CALL DEMO] Vobiz call trigger failed:', vobizRes.error)
            await supabaseAdmin
                .from('leads')
                .update({ voice_call_status: 'failed' })
                .eq('id', lead.id)

            return NextResponse.json({
                error: vobizRes.error || 'Failed to place call via telephony provider.'
            }, { status: 500 })
        }

        // 4. Log demo start in lead_history
        try {
            await supabaseAdmin.from('lead_history').insert({
                lead_id: lead.id,
                user_id: BIOQUE_USER_ID,
                action_type: 'REMARK',
                description: `🎙️ AI Demo Call initiated to ${prospectName} (${cleanPhone}) via Bioque Estates virtual line (${BIOQUE_CALLER_NUMBER}). Voice: ${voiceName}. Template: ${templateTitle}. Zero credit deduction active.`
            })
        } catch (hErr) {
            console.warn('[AI CALL DEMO] History log warning:', hErr)
        }

        return NextResponse.json({
            success: true,
            leadId: lead.id,
            callUuid: vobizRes.callUuid,
            callerNumber: BIOQUE_CALLER_NUMBER,
            voiceName,
            campaignId: campaign?.id,
            message: `Outbound AI Call Demo dialed to ${cleanPhone} from ${BIOQUE_CALLER_NUMBER}!`
        })

    } catch (e: any) {
        console.error('[AI CALL DEMO] Unexpected error:', e)
        return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
    }
}

export async function GET(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
        }

        const { data: callerProfile } = await supabaseAdmin
            .from('profiles')
            .select('role, email')
            .eq('id', user.id)
            .single()

        const isSuperAdmin = callerProfile?.role === 'super_admin' || callerProfile?.email === 'rchopra489@gmail.com'
        if (!isSuperAdmin) {
            return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
        }

        const url = new URL(req.url)
        const leadId = url.searchParams.get('leadId')

        if (leadId) {
            // Fetch live status for a specific demo call
            const { data: lead, error: leadErr } = await supabaseAdmin
                .from('leads')
                .select('*')
                .eq('id', leadId)
                .maybeSingle()

            if (leadErr || !lead) {
                return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })
            }

            const { data: history } = await supabaseAdmin
                .from('lead_history')
                .select('*')
                .eq('lead_id', leadId)
                .order('created_at', { ascending: false })
                .limit(10)

            return NextResponse.json({
                success: true,
                lead,
                history: history || []
            })
        }

        // Return recent 25 demo calls for Super Admin review
        const { data: recentDemoCalls, error: recErr } = await supabaseAdmin
            .from('leads')
            .select('*')
            .eq('source', 'AI Call Demo')
            .order('created_at', { ascending: false })
            .limit(25)

        if (recErr) {
            return NextResponse.json({ error: recErr.message }, { status: 500 })
        }

        return NextResponse.json({
            success: true,
            recentDemoCalls: recentDemoCalls || [],
            bioqueNumber: BIOQUE_CALLER_NUMBER
        })

    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Internal server error' }, { status: 500 })
    }
}
