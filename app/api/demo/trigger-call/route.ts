import { NextResponse } from 'next/server';
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js';
import { triggerVobizOutboundCall } from '@/utils/vobiz-helper';

const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

// Active virtual calling infrastructure
const DEMO_HOST_USER_ID = '68b55a31-a16d-454d-a20f-11adabf590b0'; // Bioque Estates account with verified virtual line
const DEMO_CALLER_NUMBER = '+917965480539';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const {
            prospectPhone,
            prospectName = 'Prospect',
            companyName = 'Luxury Real Estate',
            projectTitle = 'Grand Horizon Villas',
            projectDescription = 'Exclusive 4BHK Sky Mansions with private plunge pool',
            projectPrice = 'Starting ₹1.85 Cr',
            location = 'Prime Corridor',
            language = 'hinglish',
            voiceName = 'Kore'
        } = body;

        if (!prospectPhone || typeof prospectPhone !== 'string' || prospectPhone.trim().length < 8) {
            return NextResponse.json({ error: 'A valid 10-digit Indian mobile number is required.' }, { status: 400 });
        }

        // Clean & normalize destination phone number (+91 E.164)
        let cleanDigits = prospectPhone.replace(/\D/g, '');
        if (cleanDigits.startsWith('00')) cleanDigits = cleanDigits.slice(2);
        if (cleanDigits.length === 10) {
            cleanDigits = '+91' + cleanDigits;
        } else if (cleanDigits.length === 12 && cleanDigits.startsWith('91')) {
            cleanDigits = '+' + cleanDigits;
        } else if (!cleanDigits.startsWith('+')) {
            cleanDigits = '+' + cleanDigits;
        }

        const isEnglish = language === 'english';

        // 1. Generate customized initial greeting
        const initialGreeting = isEnglish
            ? `Hello ${prospectName}, this is Priya calling from ${companyName} regarding your inquiry about ${projectTitle}. Do you have a quick minute to speak?`
            : `Hi ${prospectName} ji, main ${companyName} se Priya baat kar rahi hoon aapki inquiry ke regarding ${projectTitle} project ke liye. Kya main aapse do minute baat kar sakti hoon?`;

        // 2. Build custom prompt tailored to this specific project
        const customPrompt = `--- CAMPAIGN SPECIFIC GUIDELINES ---
COMPANY NAME: "${companyName}"
PROJECT TITLE: "${projectTitle}"
LOCATION: "${location}"
PRICING / OFFER: "${projectPrice}"
PROJECT HIGHLIGHTS: "${projectDescription}"
PROSPECT NAME: "${prospectName}"
DEFAULT LANGUAGE: ${isEnglish ? 'Indian English' : 'Hinglish'}

GREETING: "${initialGreeting}"

ROLE & CONTEXT:
You are Priya, a polite, professional, and knowledgeable sales advisor calling from ${companyName}. The prospect (${prospectName}) just clicked on your Meta/Instagram advertisement and submitted a lead form inquiring about ${projectTitle}.

YOUR OBJECTIVES:
1. Greet the prospect warmly and confirm if they submitted an inquiry for ${projectTitle}.
2. Highlight key USPs naturally: Located in ${location}, ${projectDescription}, with exclusive launch pricing at ${projectPrice}.
3. Understand their requirement (e.g. looking for self-use or investment, preferred configuration).
4. Secure a commitment for an in-person VIP site visit or zoom consultation this weekend or tomorrow.
5. Once they agree to a visit or time, confirm their slot enthusiastically and thank them.

RULES:
- Keep every response concise (1 to 2 sentences max) so it feels like a natural human phone call.
- Always be courteous, enthusiastic, and helpful.
- If asked about pricing or payment plans, mention "${projectPrice} with flexible payment milestones" and invite them for a site visit to view the model unit.`;

        console.log(`[Demo AI Call] Initiating outbound demo call to ${cleanDigits} (${prospectName}) from ${DEMO_CALLER_NUMBER}...`);

        // 3. Create dedicated voice campaign
        const campaignName = `Live Demo Call - ${prospectName} (${projectTitle})`;
        const { data: campaign, error: campErr } = await supabaseAdmin
            .from('voice_campaigns')
            .insert({
                user_id: DEMO_HOST_USER_ID,
                name: campaignName,
                audience_filter: {
                    voice_name: voiceName,
                    is_demo: true,
                    language: isEnglish ? 'english' : 'hinglish',
                    greeting: initialGreeting,
                    business_name: companyName
                },
                custom_prompt: customPrompt,
                status: 'running'
            })
            .select()
            .single();

        if (campErr) {
            console.error('[Demo AI Call] Voice campaign creation warning:', campErr);
        }

        // 4. Create Lead Record tagged for demo
        const { data: lead, error: leadErr } = await supabaseAdmin
            .from('leads')
            .insert({
                user_id: DEMO_HOST_USER_ID,
                name: prospectName,
                phone: cleanDigits,
                source: 'Interactive SaaS Live Demo',
                pipeline_stage: 'New Lead',
                status: 'New Lead',
                voice_campaign_id: campaign?.id || null,
                voice_call_status: 'calling',
                notes: `[🎙️ SaaS Live Demo Call]\nBusiness: ${companyName}\nProject: ${projectTitle} (${location})\nPrice: ${projectPrice}\nProspect: ${prospectName}`,
                custom_fields: {
                    is_demo_call: true,
                    is_test_call: true,
                    skip_credit_deduction: true,
                    allow_after_hours: true,
                    demo_business_name: companyName,
                    demo_project_title: projectTitle,
                    demo_prompt: customPrompt,
                    meta_ad_origin: {
                        campaign_name: `${projectTitle} - Autonomous Meta Ad`,
                        product_name: `${projectTitle} (${projectPrice})`,
                        ad_name: 'Concept 1: Luxury 3:4 Ad'
                    }
                }
            })
            .select()
            .single();

        if (leadErr || !lead) {
            console.error('[Demo AI Call] Error inserting demo lead:', leadErr);
            return NextResponse.json({
                error: 'Failed to initialize prospect record: ' + (leadErr?.message || 'Unknown')
            }, { status: 500 });
        }

        // 5. Dial outbound call via Vobiz telephony
        const vobizRes = await triggerVobizOutboundCall(supabaseAdmin, {
            leadId: lead.id,
            profileId: DEMO_HOST_USER_ID,
            toPhone: cleanDigits,
            fromPhone: DEMO_CALLER_NUMBER,
            campaignId: campaign?.id,
            allowAfterHours: true,
            skipCreditCheck: true,
            voiceName: voiceName
        });

        if (!vobizRes.success && !vobizRes.scheduled) {
            console.error('[Demo AI Call] Vobiz trigger error:', vobizRes.error);
            await supabaseAdmin
                .from('leads')
                .update({ voice_call_status: 'failed' })
                .eq('id', lead.id);

            return NextResponse.json({
                error: vobizRes.error || 'Failed to connect via telephony provider.'
            }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            leadId: lead.id,
            callUuid: vobizRes.callUuid,
            callerNumber: DEMO_CALLER_NUMBER,
            voiceName,
            greeting: initialGreeting,
            message: `Outbound AI Call dialed to ${cleanDigits} from ${DEMO_CALLER_NUMBER}!`
        });

    } catch (err: any) {
        console.error('[Demo AI Call] Unexpected error:', err);
        return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
}
