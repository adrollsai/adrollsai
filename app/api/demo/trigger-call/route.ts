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
            voiceName = 'Charon'
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

        const langLower = (language || 'hinglish').toLowerCase();
        let initialGreeting = '';
        let startingLangLabel = 'Hinglish (Hindi + English)';

        if (langLower.includes('marathi')) {
            startingLangLabel = 'Marathi (मराठी)';
            initialGreeting = `नमस्कार ${prospectName} जी, मी ${companyName} मधून कबीर बोलतोय, ${projectTitle} प्रोजेक्टबद्दल तुमच्या चौकशीसंदर्भात. मी आपल्याशी दोन मिनिटे बोलू शकतो का?`;
        } else if (langLower.includes('gujarati')) {
            startingLangLabel = 'Gujarati (ગુજરાતી)';
            initialGreeting = `નમસ્તે ${prospectName} ભાઈ/બેન, હું ${companyName} તરફથી કબીર વાત કરું છું, ${projectTitle} પ્રોજેક્ટ વિશે તમારી પૂછપરછ બાબતે. શું હું આપની સાથે બે મિનિટ વાત કરી શકું?`;
        } else if (langLower.includes('telugu')) {
            startingLangLabel = 'Telugu (తెలుగు)';
            initialGreeting = `నమస్కారం ${prospectName} గారు, నేను ${companyName} నుండి కబీర్ మాట్లాడుతున్నాను, ${projectTitle} ప్రాజెక్ట్ గురించి మీరు చేసిన ఎంక్వైరీ కోసం. రెండు నిమిషాలు మాట్లాడవచ్చా?`;
        } else if (langLower.includes('tamil')) {
            startingLangLabel = 'Tamil (தமிழ்)';
            initialGreeting = `வணக்கம் ${prospectName} அவர்களே, நான் ${companyName} லிருந்து கபீர் பேசுகிறேன், ${projectTitle} ப்ராஜெக்ட் குறித்த உங்கள் விசாரணைக்காக. இரண்டு நிமிடங்கள் பேசலாமா?`;
        } else if (langLower.includes('kannada')) {
            startingLangLabel = 'Kannada (ಕನ್ನಡ)';
            initialGreeting = `ನಮಸ್ಕಾರ ${prospectName} ಅವರೇ, ನಾನು ${companyName} ಇಂದ ಕಬೀರ್ ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ, ${projectTitle} ಪ್ರಾಜೆಕ್ಟ್ ಬಗ್ಗೆ ನಿಮ್ಮ ವಿಚಾರಣೆಗಾಗಿ. ಎರಡು ನಿಮಿಷ ಮಾತನಾಡಬಹುದೇ?`;
        } else if (langLower.includes('bengali')) {
            startingLangLabel = 'Bengali (বাংলা)';
            initialGreeting = `নমস্কার ${prospectName} বাবু, আমি ${companyName} থেকে কবীর বলছি, ${projectTitle} প্রজেক্ট নিয়ে আপনার অনুসন্ধানের ব্যাপারে। আপনার সাথে কি দু মিনিট কথা বলতে পারি?`;
        } else if (langLower.includes('punjabi')) {
            startingLangLabel = 'Punjabi (ਪੰਜਾਬੀ)';
            initialGreeting = `Sat Sri Akal ${prospectName} ji, main ${companyName} ton Kabir bol reha haan ${projectTitle} baare. Ki tussi do minute gal kar sakde ho ji?`;
        } else if (langLower.includes('hindi') && !langLower.includes('hinglish')) {
            startingLangLabel = 'Pure Hindi (हिन्दी)';
            initialGreeting = `नमस्ते ${prospectName} जी, मैं ${companyName} से कबीर बात कर रहा हूँ, ${projectTitle} प्रोजेक्ट में आपकी रुचि के संदर्भ में। क्या मैं आपसे दो मिनट बात कर सकता हूँ?`;
        } else if (langLower.includes('english')) {
            startingLangLabel = 'Indian English';
            initialGreeting = `Hello ${prospectName}, this is Kabir calling from ${companyName} regarding your inquiry about ${projectTitle}. Do you have a brief moment to speak?`;
        } else {
            startingLangLabel = 'Conversational Hinglish';
            initialGreeting = `Namaste ${prospectName} ji, main ${companyName} se Kabir baat kar raha hoon aapki inquiry ke regarding ${projectTitle} project ke liye. Kya main aapse do minute baat kar sakta hoon?`;
        }

        // 2. Build custom prompt tailored to this specific project with dynamic multilingual code-switching
        const customPrompt = `--- DYNAMIC MULTILINGUAL SALES ADVISOR ---
COMPANY NAME: "${companyName}"
PROJECT TITLE: "${projectTitle}"
LOCATION: "${location}"
PRICING / OFFER: "${projectPrice}"
PROJECT HIGHLIGHTS: "${projectDescription}"
PROSPECT NAME: "${prospectName}"
PRIMARY STARTING LANGUAGE: ${startingLangLabel}

GREETING: "${initialGreeting}"

ROLE, PERSONA & TONE:
You are Kabir, a seasoned, highly respectable senior luxury property advisor calling from ${companyName}. The prospect (${prospectName}) submitted an inquiry regarding ${projectTitle}.

CRITICAL VOICE & CADENCE INSTRUCTIONS (CALM & COMPOSED):
- You must speak in an exceptionally CALM, COMPOSED, POISED, and DIGNIFIED male tone at all times.
- Speak at a relaxed, unhurried, measured pace with natural pauses between sentences.
- Never sound rushed, aggressive, loud, or pushy. Radiate quiet confidence, warmth, and luxury hospitality.
- Listen attentively to the prospect and acknowledge their preferences gently before giving advice.

YOUR OBJECTIVES:
1. Greet the prospect warmly and calmly in ${startingLangLabel} using the exact GREETING provided.
2. Confirm if they submitted an inquiry for ${projectTitle} and answer any questions with poise.
3. Highlight key USPs naturally: Located in ${location}, ${projectDescription}, with launch pricing at ${projectPrice}.
4. Understand their requirement (e.g. looking for self-use or investment, preferred configuration).
5. Secure a commitment for an in-person VIP site visit or private consultation this weekend.

CRITICAL MULTILINGUAL CODE-SWITCHING INSTRUCTION:
- You must START the conversation in ${startingLangLabel} using the exact GREETING provided.
- DYNAMIC CODE-SWITCHING: If the prospect replies, speaks, or asks to speak in ANY other language (such as English, Hindi, Hinglish, Punjabi, Marathi, Gujarati, Bengali, Tamil, Telugu, Kannada, etc.), you must IMMEDIATELY and SMOOTHLY switch to that language for all your following replies!
- DEFAULT TO INDIAN ENGLISH ACCENT: When speaking in English or if the prospect asks to switch to English (e.g. "talk in English", "can you speak in English?", "switch to English"), you MUST speak in a natural, calm, and polished INDIAN ENGLISH accent with authentic Indian cadence and phrasing. Absolutely NEVER speak in an American, British, or robotic Western accent.
- Never tell the user you cannot speak a language. Seamlessly match the prospect's language choice, accent, and cultural tone while continuing to qualify the lead.

RULES:
- Keep every response concise (1 to 2 sentences max) so it feels like a natural human phone call.
- Always be courteous, deeply respectful, calm, and composed.
- If asked about pricing or payment plans, mention "${projectPrice} with flexible payment milestones" and gently invite them for a site visit to view the model unit.`;

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
                    language: langLower,
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
