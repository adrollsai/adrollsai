const fs = require('fs');
const path = require('path');
const express = require('express');
const ws = require('ws');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables (look in root directory for local dev)
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
require('dotenv').config(); // Fallback for container system variables

const PORT = process.env.PORT || 8080;

// Initialize Supabase Admin Client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://hpssqssdewmkmafxlfud.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhwc3Nxc3NkZXdta21hZnhsZnVkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjgxMTkyMSwiZXhwIjoyMDk4Mzg3OTIxfQ.HgzsU10Lft2bpkOe5SMx-MyW_kmx0ld7txyqe8grlAA';

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
    realtime: {
        transport: ws
    }
});

const defaultApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';

function computeValidCallingSlot(targetDate = new Date(), timeZone = 'Asia/Kolkata') {
    // Ensure targetDate is in the future
    if (targetDate.getTime() <= Date.now() + (5 * 60 * 1000)) {
        targetDate = new Date(Date.now() + (60 * 60 * 1000)); // Default to 1 hour from now
    }

    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: 'numeric',
        minute: 'numeric',
        hour12: false
    });
    const formattedStr = formatter.format(targetDate);
    const [hStr, mStr] = formattedStr.split(':');
    const hourVal = parseInt(hStr, 10);
    const minuteVal = parseInt(mStr, 10);
    
    const timeInMinutes = hourVal * 60 + minuteVal;
    const startMinutes = 9 * 60;     // 9:00 AM
    const endMinutes = 19 * 60;      // 7:00 PM (19:00)

    const isWithinWindow = timeInMinutes >= startMinutes && timeInMinutes < endMinutes;
    if (isWithinWindow) {
        return { isWithinWindow: true, scheduledTime: targetDate };
    }

    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        hour12: false
    }).formatToParts(targetDate);
    const partMap = Object.fromEntries(parts.map(p => [p.type, p.value]));
    
    const year = parseInt(partMap.year, 10);
    const month = parseInt(partMap.month, 10) - 1;
    let targetDay = parseInt(partMap.day, 10);
    const hour = parseInt(partMap.hour, 10);
    
    if (hour >= 19) {
        targetDay += 1;
    }

    const localUtcTs = Date.UTC(year, month, targetDay, 9, 0, 0, 0);
    const getOffset = (tz, d) => {
        const tzStr = d.toLocaleString('en-US', { timeZone: tz });
        const locD = new Date(tzStr);
        const utcD = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
        return (locD.getTime() - utcD.getTime()) / 60000;
    };
    const offsetMin = getOffset(timeZone, new Date(localUtcTs));
    const nextSlot = new Date(localUtcTs - offsetMin * 60000);

    return { isWithinWindow: false, scheduledTime: nextSlot };
}

// Express Server setup
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const prewarmedPool = new Map();

app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'gemini-voice-bridge' });
});

// Vobiz Answer XML endpoint (Returns Stream XML directly to Vobiz)

async function buildGeminiSetupConfig(leadId, profileId, campaignId, voiceName = 'Aoede') {
    const campaignPromise = campaignId
        ? supabaseAdmin.from('voice_campaigns').select('*').eq('id', campaignId).maybeSingle()
        : Promise.resolve({ data: null });

    const [profileRes, leadRes, campaignRes, flaggedRes] = await Promise.all([
        supabaseAdmin.from('profiles').select('*').eq('id', profileId).maybeSingle(),
        supabaseAdmin.from('leads').select('*').eq('id', leadId).maybeSingle(),
        campaignPromise,
        supabaseAdmin.from('flagged_questions').select('*').eq('lead_id', leadId).eq('resolved', true).not('answer', 'is', null)
    ]);

    let lead = leadRes?.data || null;
    const effectiveProfileId = (lead && lead.user_id) ? lead.user_id : profileId;
    let profile = profileRes?.data || null;

    if (effectiveProfileId && (effectiveProfileId !== profileId || !profile)) {
        const ownerProfileRes = await supabaseAdmin.from('profiles').select('*').eq('id', effectiveProfileId).maybeSingle();
        profile = ownerProfileRes?.data || profile;
    }

    let campaign = campaignRes ? campaignRes.data : null;
    if (!campaign && lead?.voice_campaign_id) {
        try {
            const { data: fallbackCamp } = await supabaseAdmin
                .from('voice_campaigns')
                .select('*')
                .eq('id', lead.voice_campaign_id)
                .maybeSingle();
            if (fallbackCamp) campaign = fallbackCamp;
        } catch (cErr) {}
    }

    // Resolve target property from catalogue
    let targetProperty = null;
    const targetPropId = campaign?.property_id || campaign?.audience_filter?.property_id || lead?.property_id;
    if (targetPropId) {
        try {
            const { data: tp } = await supabaseAdmin.from('properties').select('*').eq('id', targetPropId).maybeSingle();
            if (tp) targetProperty = tp;
        } catch (e) {}
    }
    if (!targetProperty) {
        try {
            const { data: allProps } = await supabaseAdmin.from('properties').select('*').eq('user_id', effectiveProfileId);
            if (allProps && allProps.length > 0) {
                const searchContext = `${campaign?.name || ''} ${lead?.ad_name || ''} ${lead?.campaign_id || ''}`.toLowerCase();
                if (searchContext.includes('shahrukh') || searchContext.includes('danube')) {
                    targetProperty = allProps.find(p => p.title?.toLowerCase().includes('shahrukh') || p.description?.toLowerCase().includes('shahrukh'));
                } else if (searchContext.includes('amritsar') || searchContext.includes('omaxe')) {
                    targetProperty = allProps.find(p => p.title?.toLowerCase().includes('amritsar') || p.title?.toLowerCase().includes('omaxe'));
                }
                if (!targetProperty && allProps.length === 1) {
                    targetProperty = allProps[0];
                }
            }
        } catch (pErr) {}
    }

    let catalogueInfo = '';
    if (targetProperty) {
        catalogueInfo = `--- PROJECT CATALOGUE & PROPERTY SPECIFICATIONS (${targetProperty.title}) ---\nProject: ${targetProperty.title}\n${targetProperty.address || targetProperty.location ? `Location: ${targetProperty.address || targetProperty.location}\n` : ''}${targetProperty.price ? `Price: ${targetProperty.price}\n` : ''}${targetProperty.description ? `Project Details & Amenities:\n${targetProperty.description}\n` : ''}------------------------------------------------------------\n`;
    }

    const resolvedQuestions = flaggedRes?.data || [];
    let resolvedQuestionsInstruction = '';
    if (resolvedQuestions.length > 0) {
        const list = resolvedQuestions.filter(q => q && q.resolution).map(q => `• Question: "${q.question}" -> Verified Answer: "${q.resolution}"`).join('\n');
        if (list) {
            resolvedQuestionsInstruction = `--- VERIFIED ANSWERS TO PREVIOUSLY ASKED QUESTIONS ---\n${list}\n`;
        }
    }

    let leadPhone = lead?.phone || null;
    let leadName = lead?.name || 'there';
    let demoBusinessName = null;
    if (lead?.custom_fields) {
        try {
            const cf = typeof lead.custom_fields === 'string' ? JSON.parse(lead.custom_fields) : lead.custom_fields;
            if (cf?.demo_business_name) demoBusinessName = cf.demo_business_name;
        } catch (e) {}
    }
    let companyName = demoBusinessName || campaign?.audience_filter?.business_name || profile?.business_name || 'Nobogent Client';
    let targetProduct = null;

    // Check WhatsApp history
    let whatsappHistory = '';
    try {
        const { data: waChat } = await supabaseAdmin
            .from('whatsapp_chats')
            .select('id')
            .eq('lead_id', leadId)
            .maybeSingle();
        if (waChat) {
            const { data: waMsgs } = await supabaseAdmin
                .from('whatsapp_messages')
                .select('direction, message_text, created_at')
                .eq('chat_id', waChat.id)
                .order('created_at', { ascending: false })
                .limit(10);
            if (waMsgs && waMsgs.length > 0) {
                whatsappHistory = waMsgs
                    .reverse()
                    .map(m => `${m.direction === 'inbound' ? 'Lead' : 'Agent'}: ${m.message_text}`)
                    .join('\n');
            }
        }
    } catch (waErr) {}

    // Check Previous Call summaries
    let previousCallsHistory = '';
    try {
        const { data: callLogs } = await supabaseAdmin
            .from('lead_history')
            .select('description, created_at')
            .eq('lead_id', leadId)
            .eq('action_type', 'REMARK')
            .order('created_at', { ascending: false })
            .limit(5);
        if (callLogs && callLogs.length > 0) {
            const parsedCalls = [];
            for (const log of callLogs) {
                if (log.description && log.description.startsWith('🎙️ CALL_JSON:')) {
                    try {
                        const rawJson = log.description.replace('🎙️ CALL_JSON:', '').trim();
                        const parsed = JSON.parse(rawJson);
                        const dateStr = new Date(log.created_at).toLocaleDateString();
                        if (parsed.summary) parsedCalls.push(`- Call on ${dateStr}: ${parsed.summary}`);
                    } catch (e) {}
                }
            }
            if (parsedCalls.length > 0) previousCallsHistory = parsedCalls.join('\n');
        }
    } catch (chErr) {}
    if (!previousCallsHistory && lead?.voice_call_summary) {
        previousCallsHistory = `- Last Call Summary: ${lead.voice_call_summary}`;
    }

    const isFirstCall = !previousCallsHistory && !whatsappHistory;

    // Meta ad origin & Facebook instant form questions
    let adProductName = '';
    let formQuestionsSummary = '';
    let formAdCampaignName = '';
    if (lead?.custom_fields) {
        try {
            const customObj = typeof lead.custom_fields === 'string' ? JSON.parse(lead.custom_fields) : lead.custom_fields;
            const origin = customObj?.meta_ad_origin || customObj;
            if (origin?.product_name) adProductName = origin.product_name;
            if (origin?.campaign_name) formAdCampaignName = origin.campaign_name;
            else if (origin?.ad_name) formAdCampaignName = origin.ad_name;

            const ignoreKeys = ['meta_ad_origin', 'is_instant_form', 'qualification_completed', 'all_facebook_lead_ids', 'last_followup_at', 'last_followup_type', 'last_followup_remark', 'last_remark', 'followup_count', 'next_action_date', 'next_action_type', 'next_action_remark', 'next_remarks', 'client_status', 'last_call_dnp', 'pipeline_stage', 'status'];
            const qPairs = [];
            for (const [k, v] of Object.entries(customObj)) {
                if (!ignoreKeys.includes(k) && v && typeof v === 'string') {
                    const cleanQ = k.replace(/_/g, ' ').replace(/\?+/g, '?').trim();
                    const cleanA = v.replace(/_/g, ' ').trim();
                    qPairs.push(`• Question in Facebook Form: "${cleanQ}" -> Prospect Answered: "${cleanA}"`);
                }
            }
            if (qPairs.length > 0) {
                formQuestionsSummary = `--- QUESTIONS & ANSWERS SUBMITTED BY PROSPECT IN FACEBOOK INSTANT FORM ---\n${qPairs.join('\n')}\n`;
            }
        } catch (e) {}
    }

    targetProduct = (targetProperty && targetProperty.title) || adProductName || formAdCampaignName || (campaign?.target_product) || 'our prime properties';

    // Build Hinglish system instruction
    const isQualifyingEnabled = profile?.qualifying_enabled !== false;
    let activeQualifyingQuestions = profile?.qualifying_questions || [];
    if (Array.isArray(campaign?.audience_filter?.qualifying_questions) && campaign.audience_filter.qualifying_questions.length > 0) {
        activeQualifyingQuestions = campaign.audience_filter.qualifying_questions;
    }

    const campaignGuidance = (campaign?.custom_prompt || campaign?.prompt)
        ? `\n--- CAMPAIGN SPECIFIC GUIDELINES ---\n${campaign.custom_prompt || campaign.prompt}\n`
        : '';

    // Extract profile business_info for default calling language
    let bi = {};
    try {
        if (profile?.business_info && typeof profile.business_info === 'string') {
            bi = JSON.parse(profile.business_info);
        } else if (profile?.business_info && typeof profile.business_info === 'object') {
            bi = profile.business_info;
        }
    } catch (e) {}

    const campGuidanceLower = campaignGuidance.toLowerCase();

    // Priority: Campaign audience filter language > Campaign prompt hints > Profile default_calling_language > 'hinglish'
    let defaultCallingLang = (
        campaign?.audience_filter?.language ||
        profile?.default_calling_language ||
        bi?.default_calling_language ||
        'hinglish'
    ).toLowerCase().trim();

    if (campGuidanceLower.includes('kannada') || campaignGuidance.includes('ಕನ್ನಡ')) {
        defaultCallingLang = 'kannada';
    } else if (campGuidanceLower.includes('punjabi')) {
        defaultCallingLang = 'punjabi';
    } else if (campGuidanceLower.includes('formal hindi') || (campGuidanceLower.includes('default language: hindi') && !campGuidanceLower.includes('hinglish'))) {
        defaultCallingLang = 'hindi';
    } else if (campGuidanceLower.includes('indian accent english') || campGuidanceLower.includes('indian english') || campGuidanceLower.includes('indian accent')) {
        defaultCallingLang = 'english';
    }

    const vLower = (voiceName || profile?.voice_gender || '').toLowerCase();
    const isFemale = !vLower.includes('orion') && !vLower.includes('puck') && !vLower.includes('charon') && !vLower.includes('fenrir') && !vLower.includes('male');

    const genderGrammarInstruction = defaultCallingLang === 'english'
        ? `GENDER IDENTITY (FEMALE): You are a warm, professional, distinctly FEMALE customer relationship representative. You MUST speak in a polite, feminine, natural Indian English tone. NEVER sound male or robotic.`
        : (isFemale
            ? `GENDER IDENTITY (FEMALE): You are Priya, a FEMALE representative. In Hindi, Hinglish, Punjabi, and Indian languages, you MUST ALWAYS use feminine verb forms and grammatical endings (e.g. "Main ${companyName} se baat kar RAHI hoon", "Main aapki help kar SAKTI hoon"). NEVER use masculine endings.`
            : `GENDER IDENTITY (MALE): You are a MALE representative. In Hindi, Hinglish, Punjabi, and Indian languages, you MUST ALWAYS use masculine verb forms and grammatical endings.`);

    const backchannelAck = isFemale
        ? `"Haan ji", "Ahan", "Hmm", "Ji bilkul", "Achha", "Samajh rahi hoon"`
        : `"Haan ji", "Ahan", "Hmm", "Ji bilkul", "Achha", "Samajh raha hoon"`;

    let languageInstruction;
    let effectiveAck = backchannelAck;

    if (defaultCallingLang === 'english') {
        languageInstruction = `CRITICAL ACCENT, PRONUNCIATION & LANGUAGE MANDATE:
- MANDATORY STARTING LANGUAGE: You MUST speak in NATURAL, POLITE, COURTEOUS URBAN INDIAN ENGLISH (South Indian / Bangalore / Mumbai professional cadence, warm clear voice).
- STRICT ACCENT DIRECTIVE (NO AMERICAN ACCENT): You MUST speak with an authentic, professional Indian English accent (crisp non-rhotic pronunciation, warm Indian intonation and inflection, clear syllables). NEVER USE AN AMERICAN, BRITISH, OR WESTERN ACCENT.
- DYNAMIC MULTILINGUAL ADAPTATION: You are fully multilingual. If the caller speaks in Hindi, Hinglish, Punjabi, Kannada, Telugu, Tamil, Marathi, Gujarati, Bengali, or another language, or asks to converse in any language, you MUST IMMEDIATELY and effortlessly switch 100% to their preferred language from your very next turn and continue the rest of the conversation comfortably and fluently in that language!
- AUTHENTIC PRONUNCIATION: Pronounce Indian names and words authentically.`;
        effectiveAck = `"Yes", "Sure", "Right", "Understood", "Definitely", "Absolutely", "Hmm"`;
    } else if (defaultCallingLang === 'kannada') {
        languageInstruction = `LANGUAGE REQUIREMENT:
- MANDATORY STARTING LANGUAGE: YOU MUST BEGIN THE CALL DIRECTLY IN NATURAL, POLITE, FLUENT KANNADA (Karnataka / Bengaluru conversational cadence).
- DYNAMIC MULTILINGUAL ADAPTATION: You are fully multilingual. If the caller replies in English, Hindi, Hinglish, Telugu, Tamil, or asks to speak in another language, IMMEDIATELY switch smoothly to their preferred language and continue the rest of the conversation in that language without any hesitation!`;
        effectiveAck = isFemale ? `"Haudu", "Sari", "Khanditha", "Ahan", "Hmm", "Samajh rahi hoon"` : `"Haudu", "Sari", "Khanditha", "Ahan", "Hmm", "Samajh raha hoon"`;
    } else if (defaultCallingLang === 'punjabi') {
        languageInstruction = `LANGUAGE REQUIREMENT:
- MANDATORY STARTING LANGUAGE: YOU MUST BEGIN THE CALL DIRECTLY IN NATURAL, RESPECTFUL, CONVERSATIONAL PUNJABI (warm, polite everyday Punjabi).
- DYNAMIC MULTILINGUAL ADAPTATION: You are fully multilingual. If the caller speaks in Hindi, Hinglish, English, or another language, or asks to speak in another language, IMMEDIATELY switch smoothly to their preferred language and continue comfortably and fluently!`;
        effectiveAck = isFemale ? `"Haan ji", "Ahan", "Ji bilkul", "Sahi gal hai", "Samajh rahi haan"` : `"Haan ji", "Ahan", "Ji bilkul", "Sahi gal hai", "Samajh reha haan"`;
    } else if (defaultCallingLang === 'hindi') {
        languageInstruction = `LANGUAGE REQUIREMENT:
- MANDATORY STARTING LANGUAGE: YOU MUST BEGIN THE CALL IN CLEAN, NATURAL, POLITE HINDI (everyday conversational Hindi, warm and courteous).
- DYNAMIC MULTILINGUAL ADAPTATION: You are fully multilingual. If the caller speaks in English, Hinglish, Punjabi, or another language, IMMEDIATELY switch smoothly to their preferred language and continue the call comfortably!`;
        effectiveAck = backchannelAck;
    } else if (defaultCallingLang === 'telugu') {
        languageInstruction = `LANGUAGE REQUIREMENT:
- MANDATORY STARTING LANGUAGE: YOU MUST BEGIN THE CALL IN NATURAL, POLITE, FLUENT TELUGU (warm Andhra / Telangana conversational cadence).
- DYNAMIC MULTILINGUAL ADAPTATION: You are fully multilingual. If the caller replies in English, Hindi, Hinglish, or another language, IMMEDIATELY switch smoothly to their preferred language and continue comfortably!`;
        effectiveAck = `"Avunu", "Sare", "Arthamaindi", "Kandithamga", "Hmm"`;
    } else if (defaultCallingLang === 'tamil') {
        languageInstruction = `LANGUAGE REQUIREMENT:
- MANDATORY STARTING LANGUAGE: YOU MUST BEGIN THE CALL IN NATURAL, POLITE, FLUENT TAMIL (warm Chennai / Tamil Nadu conversational cadence).
- DYNAMIC MULTILINGUAL ADAPTATION: You are fully multilingual. If the caller replies in English, Hindi, or another language, IMMEDIATELY switch smoothly to their preferred language and continue comfortably!`;
        effectiveAck = `"Aam", "Sari", "Purinjadhu", "Kandippa", "Hmm"`;
    } else if (defaultCallingLang === 'marathi') {
        languageInstruction = `LANGUAGE REQUIREMENT:
- MANDATORY STARTING LANGUAGE: YOU MUST BEGIN THE CALL IN NATURAL, POLITE, FLUENT MARATHI (warm Maharashtra conversational cadence).
- DYNAMIC MULTILINGUAL ADAPTATION: You are fully multilingual. If the caller replies in Hindi, English, Hinglish, or another language, IMMEDIATELY switch smoothly to their preferred language and continue comfortably!`;
        effectiveAck = `"Ho", "Barobar", "Kallan", "Nakkich", "Hmm"`;
    } else if (defaultCallingLang === 'gujarati') {
        languageInstruction = `LANGUAGE REQUIREMENT:
- MANDATORY STARTING LANGUAGE: YOU MUST BEGIN THE CALL IN NATURAL, POLITE, FLUENT GUJARATI (warm Gujarat conversational cadence).
- DYNAMIC MULTILINGUAL ADAPTATION: You are fully multilingual. If the caller replies in Hindi, English, Hinglish, or another language, IMMEDIATELY switch smoothly to their preferred language and continue comfortably!`;
        effectiveAck = `"Ha", "Barobar", "Samjayu", "Chokkas", "Hmm"`;
    } else if (defaultCallingLang === 'bengali') {
        languageInstruction = `LANGUAGE REQUIREMENT:
- MANDATORY STARTING LANGUAGE: YOU MUST BEGIN THE CALL IN NATURAL, POLITE, FLUENT BENGALI (warm Kolkata conversational cadence).
- DYNAMIC MULTILINGUAL ADAPTATION: You are fully multilingual. If the caller replies in Hindi, English, Hinglish, or another language, IMMEDIATELY switch smoothly to their preferred language and continue comfortably!`;
        effectiveAck = `"Haa", "Thik ache", "Bujhte perechi", "Nischoy", "Hmm"`;
    } else {
        // Default to Hinglish
        languageInstruction = `LANGUAGE REQUIREMENT:
- DEFAULT TO NATURAL, FLUENT HINGLISH (conversational mix of Hindi and English, written in Latin script).
- DYNAMIC MULTILINGUAL ADAPTATION: You are fully multilingual. If the caller speaks in English, Hindi, Punjabi, Kannada, Telugu, Tamil, Marathi, Gujarati, Bengali, or another regional language, or asks to converse in any language, IMMEDIATELY switch to their language and converse comfortably, fluently, and naturally!`;
        effectiveAck = backchannelAck;
    }

    const conversationNods = defaultCallingLang === 'english'
        ? `"Hmm...", "Yes...", "Right...", "Definitely...", or "Understood..."`
        : `"Hmm...", "Ahan...", "Haan ji...", "Achha...", or "Ji bilkul..."`;

    const whatsappProhibitionDirective = `
CRITICAL DIRECTIVE — ABSOLUTE PROHIBITION ON WHATSAPP:
- Under NO circumstances should you EVER say, promise, or imply that you or an AI will send info, brochures, or messages on WhatsApp!
- If the prospect asks: "Send details on WhatsApp", "WhatsApp me", "WhatsApp kar do", or similar:
  NEVER agree to send it on WhatsApp yourself.
  Instead, politely say:
  ${defaultCallingLang === 'english'
    ? '"Certainly, I\'ll connect you with our senior relationship manager who will get in touch with you directly and share all the details."'
    : '"Ji bilkul sir, main hamare senior relationship manager ko bol deti hoon, woh aapse directly connect karke saari details share kar denge."'
  }
  Then smoothly transition to confirm their preferred time for the relationship manager to call or say a polite goodbye.`;

    const defaultFlow = `
KEY OBJECTIVE & CALL FLOW (3-STEP INDUSTRY AGNOSTIC TEMPLATE):
1. STEP 1: GREETING & ENQUIRY CONFIRMATION
   - The opening greeting has already been delivered asking if they are still looking into ${targetProduct}.
   - IF CALLER SAYS "HELLO?", "CAN YOU HEAR ME?", OR "WHO IS THIS?":
     Respond warmly and concisely: "Yes, hi! I can hear you clearly. I'm calling from ${companyName} regarding your enquiry for ${targetProduct}."
     -> STOP TALKING IMMEDIATELY AND WAIT FOR THEM TO CONFIRM.

2. STEP 2: DISCOVERY (WHEN CALLER CONFIRMS INTEREST)
   - When caller says "Yes / Go ahead / Tell me / Sure":
   - Share a crisp 1-sentence value proposition of ${targetProduct}.
   - Ask 1 single quick discovery question (e.g. "Were you looking into this for personal use or investment?").
   - STOP TALKING COMPLETELY AND LISTEN TO CALLER.

3. STEP 3: SOFT-CLOSE & APPOINTMENT SCHEDULING
   - When caller answers discovery question, acknowledge warmly.
   - Say: "Understood! I'll have our senior project manager get in touch with you directly with all the specifics. Do you prefer a quick call today afternoon, or tomorrow morning?"
   - STOP TALKING AND WAIT FOR CALLER'S PREFERRED TIME WINDOW.
   - Once caller indicates their preferred time (e.g. "tomorrow morning", "today afternoon", or a specific time):
     Say: "Perfect, I've noted that down! They will reach out to you then. Have a wonderful day!"
   - Trigger 'book_appointment_slot' with the chosen time and trigger 'end_call'.
   - NO LIVE TRANSFERS. NO PROMISES OF WHATSAPP BROCHURES. NEVER PROMISE TO SEND ANYTHING ON WHATSAPP.

CRITICAL CONVERSATIONAL DISCIPLINE:
1. STRICT BREVITY: Maximum 1 to 2 short sentences per turn. Never monologue or give long speeches!
2. ALWAYS PAUSE AND LISTEN: After asking a question, STOP TALKING COMPLETELY and wait for caller.
3. NEVER REPEAT GREETING: Do not re-introduce yourself or repeat greetings once conversation starts.
4. IF CALLER ASKS SPECIFICS (Price, Location, Features):
   Give a crisp 1-sentence answer, then pivot smoothly back to Step 3: "Our senior project manager can share the complete detailed breakdown with you. Would today afternoon or tomorrow morning suit you better?"
5. IF CALLER REQUESTS WHATSAPP: Strictly follow the WHATSAPP PROHIBITION DIRECTIVE above. Connect with relationship manager.
6. END CALL CLEANLY: Trigger 'end_call' once preferred time is noted and farewell is exchanged.
`;

    const voiceLockDirective = `
ABSOLUTE VOICE LOCK & FEMININE TIMBRE (CRITICAL — NEVER VIOLATE):
- You MUST maintain your bright, warm, distinctly feminine voice (Aoede timbre, natural pitch range 190-215 Hz) from your very first word until the call ends.
- STRICT PROHIBITION AGAINST TIMBRE DRIFT: NEVER drop into a deeper, heavier, flat, or masculine vocal fry at ANY point in the call, especially during closing turns.
- NEVER adopt an American, British, or Western accent. Maintain authentic Urban Indian cadence.
- Every single turn, whether greeting, answering a question, or saying goodbye, MUST sound identically pleasant, bright, and feminine.
- Your voice identity is LOCKED for the entire duration of this call session. No exceptions.`;

    const systemInstruction = `
You are an expert, professional outbound AI relationship representative calling on behalf of "${companyName}".
You are speaking directly over the phone with ${leadName}.

${voiceLockDirective}

${languageInstruction}

${whatsappProhibitionDirective}

${genderGrammarInstruction}

${campaignGuidance ? `${campaignGuidance}\n\n${whatsappProhibitionDirective}\n` : defaultFlow}

${catalogueInfo}
${formQuestionsSummary}
${resolvedQuestionsInstruction}
`.trim();

    const validVoiceNames = ['Aoede', 'Kore', 'Puck', 'Charon', 'Fenrir'];
    let chosenVoice = 'Aoede';
    if (voiceName && validVoiceNames.includes(voiceName)) {
        chosenVoice = voiceName;
    }

    const setupPayload = {
        setup: {
            model: process.env.GEMINI_LIVE_MODEL || "models/gemini-3.1-flash-live-preview",
            generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: {
                            voiceName: chosenVoice
                        }
                    }
                }
            },
            systemInstruction: {
                parts: [{ text: systemInstruction }]
            },
            tools: [
                {
                    functionDeclarations: [
                        {
                            name: "end_call",
                            description: "Ends the phone call when the conversation is finished, meeting is booked, or client wishes to hang up."
                        },
                        {
                            name: "search_properties",
                            description: "Searches available property inventory by location, bedrooms (BHK), budget, or property type.",
                            parameters: {
                                type: "OBJECT",
                                properties: {
                                    query: { type: "STRING", description: "Search keyword or project name" },
                                    bhk: { type: "STRING", description: "Number of bedrooms (e.g. 2BHK, 3BHK, Plots)" }
                                }
                            }
                        },
                        {
                            name: "book_appointment_slot",
                            description: "Confirms and books an appointment with the senior Relationship Manager. MUST ONLY be called AFTER the customer has explicitly agreed and chosen their convenient day and time. NEVER call this before the customer provides their time.",
                            parameters: {
                                type: "OBJECT",
                                properties: {
                                    slot_time: { type: "STRING", description: "Agreed date & time chosen by the caller (e.g. Tomorrow 11:00 AM)" },
                                    notes: { type: "STRING", description: "Customer preferences or notes" }
                                },
                                required: ["slot_time"]
                            }
                        }
                    ]
                }
            ],
            realtimeInputConfig: {
                automaticActivityDetection: {
                    startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
                    endOfSpeechSensitivity: "END_SENSITIVITY_HIGH",
                    silenceDurationMs: 300
                }
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {}
        }
    };

    return {
        profile,
        lead,
        campaign,
        companyName,
        targetProduct,
        leadName,
        leadPhone,
        voiceName,
        activeQuestionsList: activeQualifyingQuestions,
        defaultLanguage: defaultCallingLang,
        systemInstruction,
        setupPayload,
        geminiApiKey: profile?.gemini_api_key || defaultApiKey
    };
}

async function prewarmSession(leadId, profileId, campaignId, voiceName = 'Aoede') {
    if (!leadId || !profileId) return null;
    const existing = prewarmedPool.get(leadId);
    if (existing && !existing.used && (Date.now() - existing.createdAt < 60000)) {
        return existing;
    }

    console.log(`[PREWARM] Starting background pre-warm for lead ${leadId}...`);
    const configPromise = buildGeminiSetupConfig(leadId, profileId, campaignId, voiceName);
    const defaultKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
    const tempSocket = new ws(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${defaultKey}`);

    const poolEntry = {
        leadId,
        profileId,
        campaignId,
        voiceName,
        tempSocket,
        configPromise,
        configData: null,
        setupComplete: false,
        used: false,
        createdAt: Date.now()
    };
    prewarmedPool.set(leadId, poolEntry);

    setTimeout(() => {
        const cur = prewarmedPool.get(leadId);
        if (cur && cur.createdAt === poolEntry.createdAt && !cur.used) {
            console.log(`[PREWARM] Cleaning up expired prewarm for lead ${leadId}`);
            if (cur.tempSocket && cur.tempSocket.readyState === ws.OPEN) {
                cur.tempSocket.close();
            }
            prewarmedPool.delete(leadId);
        }
    }, 60000);

    const sendSetup = async () => {
        try {
            const config = await configPromise;
            poolEntry.configData = config;
            if (tempSocket.readyState === ws.OPEN) {
                console.log(`[PREWARM] Gemini Socket opened. Sending setup payload for lead ${leadId}...`);
                tempSocket.send(JSON.stringify(config.setupPayload));
            }
        } catch (e) {
            console.error(`[PREWARM] Error sending setup payload:`, e);
        }
    };

    if (tempSocket.readyState === ws.OPEN) {
        sendSetup();
    } else {
        tempSocket.once('open', sendSetup);
    }

    const onPrewarmMsg = (data) => {
        try {
            const msg = JSON.parse(data.toString());
            if (msg.setupComplete) {
                console.log(`[PREWARM] Gemini setupComplete received in advance for lead ${leadId}! Session is HOT.`);
                poolEntry.setupComplete = true;
            }
        } catch (e) {}
    };
    tempSocket.on('message', onPrewarmMsg);

    tempSocket.once('error', (err) => {
        console.error(`[PREWARM] Error on prewarmed socket for lead ${leadId}:`, err);
    });

    return poolEntry;
}


app.all(['/vobiz-xml', '/api/voice/vobiz/xml'], (req, res) => {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    const wsProtocol = protocol === 'https' ? 'wss' : 'ws';
    const leadId = req.query.leadId || req.body?.leadId || '';
    const profileId = req.query.profileId || req.body?.profileId || '';
    const campaignId = req.query.campaignId || req.body?.campaignId || '';

    const reqVoiceName = req.query.voiceName || req.body?.voiceName || '';
    const wsUrl = `${wsProtocol}://${host}/gemini-live-stream?leadId=${leadId}&profileId=${profileId}&campaignId=${campaignId}&telephony=vobiz${reqVoiceName ? `&voiceName=${encodeURIComponent(reqVoiceName)}` : ''}`;
    const escapedWsUrl = wsUrl.replace(/&/g, '&amp;');
    const statusUrl = `${protocol}://${host}/vobiz-status?leadId=${leadId}`;

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-l16;rate=16000" statusCallbackUrl="${statusUrl}">${escapedWsUrl}</Stream>
</Response>`;

    // Auto-prewarm if not already prewarmed
    if (leadId && profileId && !prewarmedPool.has(leadId)) {
        console.log(`[BRIDGE VOBIZ-XML] Auto-prewarming session for lead ${leadId}...`);
        prewarmSession(leadId, profileId, campaignId, req.query.voiceName || 'Aoede');
    }

    // Auto-trigger call recording if CallUUID is present
    const callUuid = req.query.CallUUID || req.body?.CallUUID || req.query.call_uuid || req.body?.call_uuid;
    if (callUuid) {
        const authId = process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86';
        const authToken = process.env.VOBIZ_AUTH_TOKEN || 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU';
        fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/Call/${callUuid}/Record/`, {
            method: 'POST',
            headers: {
                'X-Auth-ID': authId,
                'X-Auth-Token': authToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                file_format: 'mp3',
                time_limit: 600,
                callback_url: `${protocol}://${host}/vobiz-status?leadId=${leadId}&event=recording`
            })
        }).then(r => r.json()).then(d => {
            console.log(`[BRIDGE VOBIZ-XML] Auto-triggered Vobiz recording for ${callUuid}:`, d);
        }).catch(e => console.warn(`[BRIDGE VOBIZ-XML] Recording trigger error:`, e.message));
    }

    console.log(`[BRIDGE VOBIZ-XML] Served Voice XML to Vobiz for lead ${leadId}:\n${xml}`);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.send(xml);
});

// Vobiz Status Callback endpoint
app.all(['/vobiz-status', '/api/voice/vobiz/status-callback'], async (req, res) => {
    const leadId = req.query.leadId || req.body?.leadId;
    const callStatus = (req.body?.CallStatus || req.body?.call_status || req.body?.Status || req.body?.event || req.body?.Event || '').toLowerCase();
    const duration = req.body?.Duration || req.body?.duration || req.body?.RecordingDuration || 0;
    const callUuid = req.body?.CallUUID || req.body?.call_uuid || '';
    const recordUrl = req.body?.RecordUrl || req.body?.RecordFile || req.body?.RecordingUrl || req.body?.recording_url || '';

    console.log(`[BRIDGE VOBIZ-STATUS] Received status for lead ${leadId}: status=${callStatus}, duration=${duration}s, callUuid=${callUuid}, recordUrl=${recordUrl}`);

    if (leadId) {
        let updatedStatus = null;
        if (['in-progress', 'answered'].includes(callStatus)) {
            updatedStatus = 'calling';
        } else if (['completed', 'hangup', 'stopped', 'recordstop'].includes(callStatus)) {
            updatedStatus = 'completed';
        } else if (['busy', 'no-answer', 'timeout', 'rejected'].includes(callStatus)) {
            updatedStatus = 'no_answer';
        } else if (['failed', 'cancelled'].includes(callStatus)) {
            updatedStatus = 'failed';
        }

        const updatePayload = {};
        if (updatedStatus) {
            updatePayload.voice_call_status = updatedStatus;
        }

        let publicRecUrl = recordUrl;
        if (recordUrl) {
            try {
                const authId = process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86';
                const authToken = process.env.VOBIZ_AUTH_TOKEN || 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU';
                const audioRes = await fetch(recordUrl, {
                    headers: { 'X-Auth-ID': authId, 'X-Auth-Token': authToken }
                });
                if (audioRes.ok) {
                    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
                    const storagePath = `${leadId}/vobiz_${Date.now()}.mp3`;
                    const { error: uploadErr } = await supabaseAdmin.storage
                        .from('lead-voice-recordings')
                        .upload(storagePath, audioBuffer, { contentType: 'audio/mpeg', upsert: true });

                    if (!uploadErr) {
                        const { data: pubData } = supabaseAdmin.storage
                            .from('lead-voice-recordings')
                            .getPublicUrl(storagePath);
                        publicRecUrl = pubData.publicUrl;
                        console.log(`[BRIDGE VOBIZ-STATUS] Saved public recording URL for lead ${leadId}: ${publicRecUrl}`);
                    } else {
                        console.warn('[BRIDGE VOBIZ-STATUS] Storage upload error:', uploadErr);
                    }
                }
            } catch (rErr) {
                console.warn('[BRIDGE VOBIZ-STATUS] Recording fetch/upload error:', rErr);
            }
            updatePayload.voice_recording_url = publicRecUrl;
        }

        if (Object.keys(updatePayload).length > 0) {
            try {
                await supabaseAdmin.from('leads').update(updatePayload).eq('id', leadId);
                console.log(`[BRIDGE VOBIZ-STATUS] Updated lead ${leadId} successfully:`, updatePayload);
            } catch (err) {
                console.warn('[BRIDGE VOBIZ-STATUS] DB update error:', err);
            }
        }

        // Also update latest lead_history if recording URL is found
        if (publicRecUrl) {
            try {
                const { data: latestHistory } = await supabaseAdmin
                    .from('lead_history')
                    .select('id, description')
                    .eq('lead_id', leadId)
                    .eq('action_type', 'REMARK')
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (latestHistory && latestHistory.description?.startsWith('🎙️ CALL_JSON:')) {
                    const rawJson = latestHistory.description.replace('🎙️ CALL_JSON:', '').trim();
                    const parsed = JSON.parse(rawJson);
                    parsed.recording_url = publicRecUrl;
                    await supabaseAdmin
                        .from('lead_history')
                        .update({ description: `🎙️ CALL_JSON:${JSON.stringify(parsed)}` })
                        .eq('id', latestHistory.id);
                }
            } catch (hErr) {
                console.warn('[BRIDGE VOBIZ-STATUS] History update error:', hErr);
            }
        }
    }

    res.json({ success: true });
});

app.post('/prewarm', async (req, res) => {
    try {
        const { leadId, profileId, campaignId, voiceName } = req.body;
        if (!leadId || !profileId) {
            return res.status(400).json({ error: 'Missing leadId or profileId in prewarm request.' });
        }
        console.log(`[PREWARM] Prewarm request for lead: ${leadId}, profile: ${profileId}`);
        const entry = await prewarmSession(leadId, profileId, campaignId, voiceName || 'Aoede');
        if (entry && !entry.setupComplete) {
            await new Promise((resolve) => {
                const timeout = setTimeout(resolve, 2500);
                const checkInterval = setInterval(() => {
                    if (entry.setupComplete || entry.used) {
                        clearTimeout(timeout);
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 50);
            });
        }
        res.json({ status: 'prewarmed', leadId, setupComplete: entry?.setupComplete || false });
    } catch (err) {
        console.error('[PREWARM] Error in prewarm handler:', err);
        res.status(500).json({ error: err.message });
    }
});

const server = app.listen(PORT, () => {
    console.log(`[BRIDGE SERVER] Listening on port ${PORT}`);
});


// WebSocket Server setup
const wss = new ws.Server({ server });

// Mu-law lookup tables and codec maths
function decodeMuLaw(uLawByte) {
    uLawByte = ~uLawByte;
    const sign = (uLawByte & 0x80);
    const exponent = (uLawByte & 0x70) >> 4;
    const mantissa = (uLawByte & 0x0F);
    let sample = (mantissa << 3) + 132;
    sample <<= exponent;
    sample -= 132;
    return sign ? -sample : sample;
}

const BIAS = 0x84;
const CLIP = 32635;
const exp_lut = [
    0,0,1,1,2,2,2,2,3,3,3,3,3,3,3,3,
    4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,
    5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,
    5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,
    6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
    6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
    6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
    6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7
];

function encodeMuLaw(number) {
    let sign, exponent, mantissa, muLaw;
    sign = (number >> 8) & 0x80;
    if (number < 0) {
        number = -number;
        sign = 0x80;
    }
    if (number > CLIP) number = CLIP;
    number += BIAS;
    if (number < 0) number = 0;
    exponent = exp_lut[(number >> 7) & 0xFF];
    mantissa = (number >> (exponent + 3)) & 0x0F;
    muLaw = ~(sign | (exponent << 4) | mantissa);
    return muLaw;
}

// Resampling Helpers
function upsample8To16(inputInt16) {
    const output = new Int16Array(inputInt16.length * 2);
    for (let i = 0; i < inputInt16.length; i++) {
        output[i * 2] = inputInt16[i];
        if (i < inputInt16.length - 1) {
            output[i * 2 + 1] = Math.round((inputInt16[i] + inputInt16[i + 1]) / 2);
        } else {
            output[i * 2 + 1] = inputInt16[i];
        }
    }
    return output;
}

function downsample24To8(inputInt16) {
    const output = new Int16Array(Math.floor(inputInt16.length / 3));
    for (let i = 0; i < output.length; i++) {
        output[i] = inputInt16[i * 3];
    }
    return output;
}

function downsample24To16(pcm24) {
    const numSamples = Math.floor(pcm24.length * 2 / 3);
    const out = new Int16Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
        const srcIdx = (i * 3) / 2;
        const idxLow = Math.floor(srcIdx);
        const idxHigh = Math.min(pcm24.length - 1, idxLow + 1);
        const frac = srcIdx - idxLow;
        out[i] = Math.round(pcm24[idxLow] * (1 - frac) + pcm24[idxHigh] * frac);
    }
    return out;
}

// Pre-load and prepare neural voice & call center ambience assets
const AUDIO_ASSETS = {};
const assetsDir = path.join(__dirname, 'audio-assets');

function loadPcmAsset(key, filename) {
    try {
        const fullPath = path.join(assetsDir, filename);
        if (!fs.existsSync(fullPath)) {
            console.warn(`[AUDIO ASSETS] Warning: file ${filename} not found at ${fullPath}`);
            return null;
        }
        const raw24 = fs.readFileSync(fullPath);
        const pcm24 = new Int16Array(raw24.buffer, raw24.byteOffset, Math.floor(raw24.length / 2));
        
        // Downsample to 16k
        const pcm16 = downsample24To16(pcm24);
        const pcm16Buf = Buffer.from(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
        
        // Downsample to 8k mu-law
        const pcm8 = downsample24To8(pcm24);
        const muLawBuf = Buffer.alloc(pcm8.length);
        for (let i = 0; i < pcm8.length; i++) {
            muLawBuf[i] = encodeMuLaw(pcm8[i]);
        }
        
        AUDIO_ASSETS[key] = {
            raw24,
            pcm24,
            base64Pcm24: raw24.toString('base64'),
            pcm16Buf,
            base64Pcm16: pcm16Buf.toString('base64'),
            muLawBuf
        };
        console.log(`[AUDIO ASSETS] Loaded asset '${key}' (${raw24.length} bytes 24kHz PCM).`);
    } catch (e) {
        console.error(`[AUDIO ASSETS] Failed to load ${filename}:`, e.message);
    }
}

loadPcmAsset('hello_female', 'hello_female_24k.pcm');
loadPcmAsset('hello_male', 'hello_male_24k.pcm');
loadPcmAsset('filler_check_details', 'filler_check_details_24k.pcm');
loadPcmAsset('filler_check_slots', 'filler_check_slots_24k.pcm');
loadPcmAsset('backchannel_hmm', 'backchannel_hmm_24k.pcm');
loadPcmAsset('backchannel_haan', 'backchannel_haan_24k.pcm');
loadPcmAsset('ambience', 'call_center_ambience_24k.pcm');

// Universal Low-Latency Audio Streamer (Vobiz 24kHz / 16kHz PCM & Twilio 8kHz mu-law)
function playClipToCaller(wsConn, clipKey, isVobiz = true, streamId = null) {
    const asset = AUDIO_ASSETS[clipKey];
    if (!asset || !wsConn || wsConn.readyState !== ws.OPEN || !streamId) return;

    // Mix subtle ambience into clip so pickup greeting has authentic office background
    let payload24 = asset.base64Pcm24;
    const ambAsset = AUDIO_ASSETS['ambience'];
    if (ambAsset && ambAsset.pcm24 && asset.pcm24) {
        const mixed = new Int16Array(asset.pcm24.length);
        const amb = ambAsset.pcm24;
        const ambVol = 0.06;
        for (let i = 0; i < asset.pcm24.length; i++) {
            const a = amb[i % amb.length];
            mixed[i] = Math.max(-32768, Math.min(32767, asset.pcm24[i] + Math.round(a * ambVol)));
        }
        payload24 = Buffer.from(mixed.buffer, mixed.byteOffset, mixed.byteLength).toString('base64');
    }
    if (isVobiz) {
        // Send downsampled 16kHz linear PCM to Vobiz
        wsConn.send(JSON.stringify({
            event: 'playAudio',
            streamId: streamId,
            media: {
                contentType: 'audio/x-l16',
                sampleRate: 16000,
                payload: asset.base64Pcm16 || payload24
            }
        }));
    } else {
        // Stream mu-law to Twilio in strict 20ms chunks (160 bytes)
        const chunkSize = 160;
        let offset = 0;
        const interval = setInterval(() => {
            if (offset >= asset.muLawBuf.length || wsConn.readyState !== ws.OPEN) {
                clearInterval(interval);
                return;
            }
            const chunk = asset.muLawBuf.subarray(offset, offset + chunkSize);
            offset += chunkSize;
            wsConn.send(JSON.stringify({
                event: 'media',
                streamSid: streamId,
                media: { payload: chunk.toString('base64') }
            }));
        }, 20);
    }
}


// Audio Signal Processing & Noise-Suppressed Stream Processor
function isMaleVoice(vName, gender) {
    const str = `${vName || ''} ${gender || ''}`.toLowerCase();
    return str.includes('male') || str.includes('fenrir') || str.includes('puck') || str.includes('charon') || str.includes('orus') || str.includes('zephyr') || str.includes('alcor') || str.includes('umbriel') || str.includes('guy') || str.includes('orion') || str.includes('pegasus') || str.includes('dipper');
}

function calculateRMS(pcm16Array) {
    let sumSquare = 0;
    for (let i = 0; i < pcm16Array.length; i++) {
        sumSquare += pcm16Array[i] * pcm16Array[i];
    }
    return Math.sqrt(sumSquare / pcm16Array.length);
}

class NoiseSuppressedAudioProcessor {
    constructor(options = {}) {
        // Barge-in: RMS threshold for caller voice to be considered "speaking" during AI output
        // Human speech directly into phone microphone is typically RMS 1600 - 5000+
        // Instant barge-in: RMS threshold for caller voice to interrupt AI output
        // Mobile cell phone mic speech is typically RMS 400 - 1500
        // Set to 400 RMS with 3 frames (60ms) so saying a single word ("price", "hello", "wait") immediately halts AI
        this.bargeInThreshold = options.bargeInThreshold || 400;
        this.sustainedBargeInNeeded = options.sustainedBargeInFrames || 3; // 3 frames * 20ms = 60ms for instant interruption
        this.voiceThreshold = options.voiceThreshold || 250; // Caller speech RMS threshold
        this.isAiSpeaking = false;
        this.aiSpeakingTimeout = null;
        this.sustainedBargeInFrames = 0;
        this.bargeInTriggered = false;
    }

    markAiSpeakingUntil(targetTimestamp) {
        this.isAiSpeaking = true;
        this.bargeInTriggered = false;
        this.sustainedBargeInFrames = 0;
        this.callerSpeechStartTime = 0;
        this.callerSilenceStartTime = 0;
        if (this.aiSpeakingTimeout) clearTimeout(this.aiSpeakingTimeout);
        const remainingMs = Math.max(100, targetTimestamp - Date.now());
        this.aiSpeakingTimeout = setTimeout(() => {
            this.isAiSpeaking = false;
            this.sustainedBargeInFrames = 0;
        }, remainingMs);
    }

    markAiSpeaking(durationMs = 1500) {
        this.isAiSpeaking = true;
        this.bargeInTriggered = false;
        this.sustainedBargeInFrames = 0;
        this.callerSpeechStartTime = 0;
        this.callerSilenceStartTime = 0;
        if (this.aiSpeakingTimeout) clearTimeout(this.aiSpeakingTimeout);
        this.aiSpeakingTimeout = setTimeout(() => {
            this.isAiSpeaking = false;
            this.sustainedBargeInFrames = 0;
        }, durationMs);
    }

    clearAiSpeaking() {
        this.isAiSpeaking = false;
        this.sustainedBargeInFrames = 0;
        this.callerSpeechStartTime = 0;
        this.callerSilenceStartTime = 0;
        if (this.aiSpeakingTimeout) clearTimeout(this.aiSpeakingTimeout);
    }

    processFrame(pcm16Chunk) {
        const rms = calculateRMS(pcm16Chunk);
        const isVoice = rms >= this.voiceThreshold;
        const now = Date.now();

        // TELEPHONY NOISE GATE:
        // Ambient mobile cellular line hiss on telephony is typically RMS 40-180.
        // When caller speaks (RMS >= 200), forward full intact 16kHz audio.
        let pcmOutput = pcm16Chunk;
        if (!isVoice && rms < 200) {
            pcmOutput = new Int16Array(pcm16Chunk.length);
        }

        const result = { pcmOutput, rms, isVoice, bargeIn: false };

        // Check for barge-in during AI speech (instant 60ms detection)
        if (this.isAiSpeaking) {
            if (rms >= this.bargeInThreshold) {
                this.sustainedBargeInFrames++;
                if (this.sustainedBargeInFrames >= this.sustainedBargeInNeeded) {
                    console.log(`[AUDIO PROCESSOR] Instant caller barge-in detected! RMS: ${Math.round(rms)}, sustained ${this.sustainedBargeInFrames} frames`);
                    this.bargeInTriggered = true;
                    this.isAiSpeaking = false; // Immediately clear AI speaking
                    this.sustainedBargeInFrames = 0;
                    result.bargeIn = true;
                    result.pcmOutput = pcm16Chunk; // Forward caller voice directly!
                }
            } else {
                this.sustainedBargeInFrames = 0;
            }
            if (!result.bargeIn) {
                result.pcmOutput = new Int16Array(pcm16Chunk.length);
            }
        }

        return result;
    }
}

// WSS Handlers
wss.on('connection', (wsConnection, req) => {
    let urlObj = null;
    try {
        urlObj = new URL(req.url, 'http://localhost');
    } catch (e) {}

    const queryLeadId = urlObj?.searchParams?.get('leadId') || urlObj?.searchParams?.get('amp;leadId');
    const queryProfileId = urlObj?.searchParams?.get('profileId') || urlObj?.searchParams?.get('amp;profileId');
    const queryCampaignId = urlObj?.searchParams?.get('campaignId') || urlObj?.searchParams?.get('amp;campaignId');
    const queryTelephony = urlObj?.searchParams?.get('telephony') || urlObj?.searchParams?.get('amp;telephony');
    const queryVoiceName = urlObj?.searchParams?.get('voiceName') || urlObj?.searchParams?.get('amp;voiceName');
    const queryCallUuid = urlObj?.searchParams?.get('callUuid') || urlObj?.searchParams?.get('amp;callUuid') || urlObj?.searchParams?.get('call_uuid');
    const queryVobizAuthId = urlObj?.searchParams?.get('vobizAuthId') || urlObj?.searchParams?.get('amp;vobizAuthId');
    const queryVobizAuthToken = urlObj?.searchParams?.get('vobizAuthToken') || urlObj?.searchParams?.get('amp;vobizAuthToken');

    // Resolve host from the WebSocket upgrade request headers (needed for Vobiz recording callback URL)
    const wsHost = req.headers['x-forwarded-host'] || req.headers.host || process.env.VOICE_BRIDGE_HOST || 'gemini-voice-bridge-805895515412.us-central1.run.app';

    let isVobiz = queryTelephony === 'vobiz';
    let vobizStreamId = null;
    let vobizCallId = queryCallUuid || null;
    let vobizContentType = 'audio/x-l16';

    console.log(`[BRIDGE] New WebSocket connection request. Telephony: ${isVobiz ? 'Vobiz' : 'Twilio/Standard'}, URL: ${req.url}`);

    let twilioStreamSid = null;
    let twilioCallSid = null;
    let geminiSocket = null;
    let geminiReady = false;
    let geminiApiKey = null;
    
    let leadId = queryLeadId || null;
    let profileId = queryProfileId || null;
    let profileData = null;
    let profile = null;
    let lead = null;
    let campaign = null;
    let activeQuestionsList = [];
    let leadPhone = null;
    let leadName = 'there';
    let companyName = 'Bioque Estates';
    let targetProduct = null;
    let greetingMessage = 'Hi, kaise ho aap?';
    const transcriptTurns = [];
    let greetingPlayed = false;
    let voiceName = (queryVoiceName && ['Aoede', 'Kore', 'Puck', 'Charon', 'Fenrir'].includes(queryVoiceName)) ? queryVoiceName : 'Aoede';

    let earlyConfigPromise = null;
    if (leadId && profileId) {
        console.log(`[BRIDGE] Early kickoff of Gemini setup config for lead ${leadId}...`);
        earlyConfigPromise = buildGeminiSetupConfig(leadId, profileId, queryCampaignId, voiceName);
    }

    const audioProcessor = new NoiseSuppressedAudioProcessor();
    const streamStartTime = Date.now();
    let isCallHangingUp = false;
    let ambienceOffset = 0;
    let ambienceInterval = null;
    let geminiGreetingStarted = false;
    let geminiGreetingFinished = false;
    let wrapUpTimer = null;
    let maxDurationTimer = null;

    // Audio playout tracker: tracks exact timestamp when queued audio finishes playing on caller device
    let aiPlaybackEndTime = 0;

    // Connection health check (heartbeat to prevent lingering ghost connections)
    let isAlive = true;
    wsConnection.on('pong', () => { isAlive = true; });

    const pingInterval = setInterval(() => {
        if (!isAlive) {
            console.log('[BRIDGE] WS connection timed out. Closing...');
            clearInterval(pingInterval);
            wsConnection.terminate();
            if (geminiSocket && geminiSocket.readyState === ws.OPEN) {
                geminiSocket.close();
            }
            return;
        }
        isAlive = false;
        if (wsConnection.readyState === ws.OPEN) {
            wsConnection.ping();
        }
    }, 15000);

    // Helper to process and forward media packets (with 80ms batch buffering to slash latency & WebSocket overhead)
    let audioBufferList = [];
    let audioBufferSamples = 0;

    function flushAudioBufferToGemini() {
        if (audioBufferSamples === 0 || !geminiSocket || geminiSocket.readyState !== ws.OPEN) return;
        try {
            const combinedPcm = new Int16Array(audioBufferSamples);
            let offset = 0;
            for (const chunk of audioBufferList) {
                combinedPcm.set(chunk, offset);
                offset += chunk.length;
            }
            audioBufferList = [];
            audioBufferSamples = 0;

            const outBuffer = Buffer.alloc(combinedPcm.length * 2);
            for (let i = 0; i < combinedPcm.length; i++) {
                outBuffer.writeInt16LE(combinedPcm[i], i * 2);
            }

            geminiSocket.send(JSON.stringify({
                realtimeInput: {
                    audio: {
                        mimeType: "audio/pcm;rate=16000",
                        data: outBuffer.toString('base64')
                    }
                }
            }));
        } catch (err) {
            console.error('[BRIDGE] Error flushing media to Gemini:', err);
        }
    }

    function sendPcmChunkToGemini(pcm16) {
        try {
            audioBufferList.push(pcm16);
            audioBufferSamples += pcm16.length;

            if (audioBufferSamples >= 640) {
                flushAudioBufferToGemini();
            }
        } catch (err) {
            console.error('[BRIDGE] Error queueing media to Gemini:', err);
        }
    }

    // Handle incoming telephony stream messages (Vobiz or Twilio)
    wsConnection.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString());

            if (data.event === 'start') {
                if (data.streamId || data.callId || queryTelephony === 'vobiz' || (!data.start && data.streamId)) {
                    isVobiz = true;
                    vobizStreamId = data.streamId || data.start?.streamId;
                    vobizCallId = data.callId || data.callUuid || data.start?.callSid || queryCallUuid;
                    vobizContentType = data.mediaFormat?.contentType || 'audio/x-l16';
                    twilioStreamSid = vobizStreamId;
                    leadId = data.customParameters?.leadId || data.start?.customParameters?.leadId || queryLeadId;
                    profileId = data.customParameters?.profileId || data.start?.customParameters?.profileId || queryProfileId;
                    var campaignId = data.customParameters?.campaignId || data.start?.customParameters?.campaignId || queryCampaignId;
                    greetingPlayed = (data.customParameters?.greetingPlayed || data.start?.customParameters?.greetingPlayed) === 'true';
                    voiceName = queryVoiceName || data.customParameters?.voiceName || data.start?.customParameters?.voiceName || voiceName || 'Aoede';
                    console.log(`[BRIDGE] Vobiz stream started. StreamId: ${vobizStreamId}, CallId: ${vobizCallId}, Format: ${vobizContentType}, leadId: ${leadId}, profileId: ${profileId}`);

                    // Trigger non-blocking background REST recording on active call
                    if (vobizCallId) {
                        const authId = queryVobizAuthId || (profileData?.business_info?.kyc_data?.vobizSubAuthId || profileData?.voice_vobiz_auth_id) || process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86';
                        const authToken = queryVobizAuthToken || (profileData?.business_info?.voice_vobiz_auth_token || profileData?.voice_vobiz_auth_token) || process.env.VOBIZ_AUTH_TOKEN || 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU';
                        const statusCallbackUrl = `https://${wsHost}/vobiz-status?leadId=${leadId}`;
                        fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/Call/${vobizCallId}/Record/`, {
                            method: 'POST',
                            headers: {
                                'X-Auth-ID': authId,
                                'X-Auth-Token': authToken,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                file_format: 'mp3',
                                time_limit: 600,
                                callback_url: statusCallbackUrl
                            })
                        }).then(r => r.json()).then(d => {
                            console.log(`[BRIDGE] Vobiz REST Record started for call ${vobizCallId}:`, d);
                        }).catch(e => console.warn('[BRIDGE] Vobiz REST Record trigger warning:', e.message));
                    }
                } else {
                    twilioStreamSid = data.start?.streamSid;
                    twilioCallSid = data.start?.callSid;
                    leadId = data.start?.customParameters?.leadId || queryLeadId;
                    profileId = data.start?.customParameters?.profileId || queryProfileId;
                    var campaignId = data.start?.customParameters?.campaignId || queryCampaignId;
                    greetingPlayed = data.start?.customParameters?.greetingPlayed === 'true';
                    voiceName = data.start?.customParameters?.voiceName || 'Aoede';
                    console.log(`[BRIDGE] Twilio call started. StreamSid: ${twilioStreamSid}, CallSid: ${twilioCallSid}, leadId: ${leadId}, profileId: ${profileId}`);
                }

                if (!leadId || !profileId) {
                    console.error('[BRIDGE] Missing customParameters: leadId or profileId in start packet.');
                    wsConnection.close(4001, 'Missing customParameters.');
                    return;
                }

                // Do NOT play pre-recorded American audio clips on connect.
                // Gemini Live generates the authentic Indian accent greeting turn directly upon session connection (<200ms).
                const isMale = isMaleVoice(voiceName, data.customParameters?.voice_gender || data.start?.customParameters?.voice_gender || profileData?.voice_gender || profile?.voice_gender);
                console.log(`[BRIDGE] Selected voice '${voiceName}' (isMale: ${isMale}) - dynamic Gemini stream active`);
                greetingPlayed = true;

                // 1. Retrieve pre-warmed session or initialize Gemini Live session on-demand
                let sessionConfig;
                let greetingTurnSent = false;
                const prewarmed = prewarmedPool.get(leadId);
                if (prewarmed && !prewarmed.used && prewarmed.tempSocket && prewarmed.tempSocket.readyState === ws.OPEN) {
                    console.log(`[BRIDGE] Found HOT PRE-WARMED session for lead ${leadId}! setupComplete=${prewarmed.setupComplete}`);
                    prewarmed.used = true;
                    prewarmedPool.delete(leadId);
                    geminiSocket = prewarmed.tempSocket;
                    geminiSocket.removeAllListeners('message');
                    geminiSocket.removeAllListeners('error');
                    geminiSocket.removeAllListeners('close');
                    sessionConfig = prewarmed.configData || (await prewarmed.configPromise);
                } else {
                    console.log(`[BRIDGE] No pre-warmed session found for lead ${leadId}. Initializing on-demand (earlyConfig: ${!!earlyConfigPromise})...`);
                    sessionConfig = await (earlyConfigPromise || buildGeminiSetupConfig(leadId, profileId, campaignId, voiceName));
                    const keyToUse = sessionConfig.geminiApiKey || defaultApiKey;
                    geminiSocket = new ws(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${keyToUse}`);
                    await new Promise((resolve) => {
                        if (geminiSocket.readyState === ws.OPEN) resolve();
                        else geminiSocket.once('open', resolve);
                    });
                    console.log('[BRIDGE] Gemini Socket opened on-demand. Sending setup config...');
                    geminiSocket.send(JSON.stringify(sessionConfig.setupPayload));
                }

                profile = sessionConfig.profile;
                profileData = profile;
                lead = sessionConfig.lead;
                campaign = sessionConfig.campaign;
                companyName = sessionConfig.companyName;
                targetProduct = sessionConfig.targetProduct;
                leadName = sessionConfig.leadName;
                leadPhone = sessionConfig.leadPhone;
                activeQuestionsList = sessionConfig.activeQuestionsList;
                geminiApiKey = sessionConfig.geminiApiKey;
                const setupPayload = sessionConfig.setupPayload;

                const sendInitialGreeting = () => {
                    if (greetingTurnSent) return;
                    greetingTurnSent = true;
                    geminiReady = true;

                    const safeCompanyName = companyName || profile?.business_name || 'Bioque Estates';
                    const safeProduct = targetProduct || 'our project';
                    const safeName = (leadName && leadName !== 'there') ? leadName.split(' ')[0] : '';
                    const nameGreeting = safeName ? `Hi ${safeName} ji` : `Hi ji`;
                    const bolRaha = isMaleVoice(voiceName, profile?.voice_gender) ? 'bol raha hoon' : 'bol rahi hoon';

                    let openGreeting = null;
                    const campPrompt = campaign?.custom_prompt || campaign?.prompt || '';
                    const campPromptLower = campPrompt.toLowerCase();

                    // 1. Direct priority: Extract explicit OPENING greeting from custom prompt if present
                    // IMPORTANT: Only match the primary opening/first greeting, NOT sub-template greetings
                    // like "Kannada Greeting:", "Hindi Greeting:", etc.
                    const promptGreetingMatch = campPrompt.match(/(?:^|\n)\s*(?:Opening Greeting|STEP 1[^:]*|First Message)\s*(?::|-)?\s*\n?\s*(?:Greeting:\s*)?["']([^"'\r\n]+)["']/im) ||
                                                campPrompt.match(/(?:^|\n)\s*GREETING:\s*["']([^"'\r\n]+)["']/im);
                    if (promptGreetingMatch && promptGreetingMatch[1]) {
                        // Verify it's not a Kannada/Hindi sub-template greeting
                        const extractedLower = promptGreetingMatch[1].toLowerCase();
                        const isSubTemplate = extractedLower.startsWith('namaskara') || extractedLower.startsWith('namaskar ') || extractedLower.includes('hegiddira') || extractedLower.includes('kaise hain');
                        const isEnglishCampaign = campPromptLower.includes('indian english') || campPromptLower.includes('indian accent') || campaign?.audience_filter?.language === 'english';

                        if (!isSubTemplate || !isEnglishCampaign) {
                            openGreeting = promptGreetingMatch[1]
                                .replace(/\{name\}/gi, safeName || 'there')
                                .replace(/\{lead_name\}/gi, safeName || 'there')
                                .replace(/\{business_name\}/gi, safeCompanyName)
                                .replace(/\{company_name\}/gi, safeCompanyName)
                                .trim();
                            console.log('[BRIDGE] Successfully extracted greeting from campaign prompt:', openGreeting);
                        } else {
                            console.log('[BRIDGE] Skipped sub-template greeting extraction (Kannada/Hindi on English campaign):', promptGreetingMatch[1].substring(0, 50));
                        }
                    }

                    // 2. Fallback to audience_filter.greeting if not a stale generic Hindi greeting on an English prompt
                    if (!openGreeting && campaign?.audience_filter?.greeting) {
                        const filterGreeting = campaign.audience_filter.greeting;
                        const isEnglishPrompt = campPromptLower.includes('english') || campPromptLower.includes('amritha') || campPromptLower.includes('mysore');
                        if (isEnglishPrompt && (filterGreeting.includes('kaise') || filterGreeting.includes('haan ji'))) {
                            console.log('[BRIDGE] Rejecting stale Hindi filter greeting on English campaign prompt:', filterGreeting);
                        } else {
                            openGreeting = filterGreeting;
                        }
                    }

                    let effectiveLang = sessionConfig?.defaultLanguage || 'hinglish';
                    if (campPromptLower.includes('kannada')) effectiveLang = 'kannada';
                    else if (campPromptLower.includes('punjabi')) effectiveLang = 'punjabi';
                    else if (campPromptLower.includes('hindi')) effectiveLang = 'hindi';
                    else if (campPromptLower.includes('english')) effectiveLang = 'english';

                    if (!openGreeting) {
                        if (effectiveLang === 'english') {
                            const safeEnName = safeName ? safeName : 'there';
                            openGreeting = `Hi ${safeEnName}, this is from ${safeCompanyName}. I saw you recently enquired about our ${safeProduct} on Facebook — just wanted to check if you're still looking into this?`;
                        } else if (effectiveLang === 'kannada') {
                            const safeKnName = safeName ? `${safeName} avare` : 'avare';
                            openGreeting = `Namaskara ${safeKnName}, naanu ${safeCompanyName} inda call maadtha iddini. Neevu Facebook alli namma ${safeProduct} bagge enquiry maadidri — adhara bagge explore maadtha iddeera antha check maadbekittu.`;
                        } else if (effectiveLang === 'punjabi') {
                            openGreeting = `Sat Sri Akal ${nameGreeting}, main ${safeCompanyName} ton bol rahi haan. Tussi Facebook par saade ${safeProduct} baare enquiry kiti si — bas confirm karna si ki tussi hale vi is baare dekh rahe ho?`;
                        } else if (effectiveLang === 'hindi') {
                            openGreeting = `Namaste ${nameGreeting}, main ${safeCompanyName} se baat kar rahi hoon. Aapne Facebook par hamare ${safeProduct} ke baare mein enquiry ki thi — kya aap abhi bhi iske baare mein explore kar rahe hain?`;
                        } else if (effectiveLang === 'telugu') {
                            const safeTeName = safeName ? `${safeName} garu` : 'andi';
                            openGreeting = `Namaskaram ${safeTeName}, nenu ${safeCompanyName} nunchi call chesthunnanu. Meeru Facebook lo ma ${safeProduct} gurinchi enquiry chesaru — meeru inka deeni gurinchi chusthunnara ani telusukotaniki call chesanu.`;
                        } else if (effectiveLang === 'tamil') {
                            const safeTaName = safeName ? `${safeName} avargale` : '';
                            openGreeting = `Vanakkam ${safeTaName}, naan ${safeCompanyName} lirundhu pesaren. Neenga Facebook la enga ${safeProduct} pathi enquiry pannirundheenga — adh pathi innum paathutu irukeengala nu therinjuka call pannen.`;
                        } else if (effectiveLang === 'marathi') {
                            openGreeting = `Namaskar ${nameGreeting}, mee ${safeCompanyName} madhun bolat ahe. Tumhi Facebook var aamchya ${safeProduct} baddal enquiry keli hoti — tumhi ajunhi ya baddal vichar karat ahat ka he janun ghenyasathi call kela ahe.`;
                        } else if (effectiveLang === 'gujarati') {
                            const safeGuName = safeName ? `${safeName} bhai` : '';
                            openGreeting = `Namaste ${safeGuName}, hu ${safeCompanyName} mathi vat karu chu. Tame Facebook par amara ${safeProduct} mate enquiry kari hati — tame haji pan aa project ma interested chho e janva call karyo chhe.`;
                        } else if (effectiveLang === 'bengali') {
                            const safeBnName = safeName ? `${safeName} babu` : '';
                            openGreeting = `Nomoshkar ${safeBnName}, aami ${safeCompanyName} theke bolchi. Aapni Facebook e aamader ${safeProduct} niye enquiry korechilen — aapni ki ekhono eta explore korchen kina jante call korlam.`;
                        } else {
                            openGreeting = `Haan ji ${nameGreeting}, main ${safeCompanyName} se baat kar rahi hoon. Aapne Facebook par hamare ${safeProduct} ke baare mein enquiry ki thi — bas check karna tha kya aap abhi bhi iske baare mein explore kar rahe hain?`;
                        }
                    }

                    if (openGreeting) {
                        openGreeting = openGreeting
                            .replace(/\{name\}/gi, safeName || 'there')
                            .replace(/\{lead_name\}/gi, safeName || 'there')
                            .replace(/\{business_name\}/gi, safeCompanyName)
                            .replace(/\{company_name\}/gi, safeCompanyName)
                            .trim();
                    }

                    const accentDirective = (effectiveLang === 'english')
                        ? "in a polite, natural Urban Indian English accent (South Indian / Bangalore professional intonation, crisp non-rhotic Indian pronunciation, strictly NO American accent)"
                        : "in a warm, natural tone in the language of the greeting";
                    const textPrompt = `The phone call has just connected. Speak EXACTLY this greeting message now ${accentDirective}, and nothing else: "${openGreeting}"
CRITICAL INSTRUCTION: After speaking this opening greeting, STOP TALKING IMMEDIATELY. You MUST wait for the caller to respond before saying another word. Do NOT pitch the project, do NOT describe amenities, and do NOT proceed until the caller explicitly confirms!`;

                    const initialTurn = {
                        clientContent: {
                            turns: [
                                {
                                    role: "user",
                                    parts: [{ text: textPrompt }]
                                }
                            ],
                            turnComplete: true
                        }
                    };
                    console.log('[BRIDGE] Sending initial greeting turn to Gemini:', JSON.stringify(initialTurn));
                    geminiSocket.send(JSON.stringify(initialTurn));
                    console.log('[BRIDGE] geminiReady set to true. Waiting for Gemini audio response...');
                };

                if (prewarmed && prewarmed.setupComplete) {
                    console.log('[BRIDGE] Session already has setupComplete! Dispatching greeting turn immediately (250ms audio link settle)...');
                    setTimeout(() => {
                        sendInitialGreeting();
                    }, 250);
                }

                isCallHangingUp = false;
                const triggerCallHangup = async (reason = 'tool_call') => {
                    if (isCallHangingUp) return;
                    isCallHangingUp = true;
                    console.log(`[BRIDGE] Initiating call hangup sequence (reason: ${reason}, isVobiz: ${isVobiz}). Waiting 2.0s for final audio playout...`);

                    // Stop receiving any further speech turns from Gemini to prevent trailing duplicate speech
                    if (geminiSocket) {
                        geminiSocket.removeAllListeners('message');
                    }
                    setTimeout(async () => {
                        try {
                            if (isVobiz) {
                                if (wsConnection.readyState === ws.OPEN && vobizStreamId) {
                                    wsConnection.send(JSON.stringify({
                                        event: 'stop',
                                        streamId: vobizStreamId
                                    }));
                                }
                                if (vobizCallId) {
                                    const vobizAuthId = process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86';
                                    const vobizAuthToken = process.env.VOBIZ_AUTH_TOKEN || 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU';
                                    try {
                                        await fetch(`https://api.vobiz.ai/api/v1/Account/${vobizAuthId}/Call/${vobizCallId}/`, {
                                            method: 'DELETE',
                                            headers: {
                                                'X-Auth-ID': vobizAuthId,
                                                'X-Auth-Token': vobizAuthToken
                                            }
                                        });
                                        console.log(`[BRIDGE] Vobiz call ${vobizCallId} hung up via REST.`);
                                    } catch (hErr) {
                                        console.error('[BRIDGE] Vobiz REST hangup failed:', hErr);
                                    }
                                }
                            } else if (twilioCallSid && profileData) {
                                const twilioSid = process.env.MASTER_TWILIO_SID;
                                const twilioToken = process.env.MASTER_TWILIO_TOKEN;
                                if (twilioSid && twilioToken) {
                                    try {
                                        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Calls/${twilioCallSid}.json`;
                                        const twilioAuth = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
                                        await fetch(twilioUrl, {
                                            method: 'POST',
                                            headers: {
                                                'Authorization': `Basic ${twilioAuth}`,
                                                'Content-Type': 'application/x-www-form-urlencoded'
                                            },
                                            body: new URLSearchParams({ Status: 'completed' })
                                        });
                                        console.log(`[BRIDGE] Twilio call ${twilioCallSid} hung up successfully via REST.`);
                                    } catch (hangupErr) {
                                        console.error('[BRIDGE] Twilio REST hangup failed:', hangupErr);
                                    }
                                }
                            }
                        } catch (e) {
                            console.error('[BRIDGE] Error in triggerCallHangup:', e);
                        } finally {
                            if (wsConnection.readyState === ws.OPEN) {
                                wsConnection.close();
                            }
                        }
                    }, 2800);
                };

                const checkAgentGoodbyeAndHangup = (text) => {
                    if (!text || isCallHangingUp) return;
                    const partingIntentRegex = /\b(thank\s*you|shukriya|alvida|have a (good|great|nice) day|bye\b|take\s*care|phir milte hain|dhanyawad|dhanyavad|talk (to you )?later|call (me )?later|busy|not now|reach out later)\b/i;
                    const agentFarewellRegex = /\b(have a (great|good|nice) day|take care|thank you.*great day|bye-bye|goodbye|dhanyavadagalu.*great day|great day\.)\b/i;
                    const userExpressedParting = transcriptTurns.some(t => t.role === 'user' && partingIntentRegex.test(t.message || ''));
                    // Immediate hangup if agent delivers farewell after user expressed parting or call has progressed
                    if (agentFarewellRegex.test(text) && (userExpressedParting || transcriptTurns.length >= 4)) {
                        console.log(`[BRIDGE] Agent farewell delivered ("${text.trim()}"). Triggering clean hangup to prevent run-on speech...`);
                        triggerCallHangup('verbal_goodbye_detected');
                    }
                };

                 geminiSocket.on('message', async (data) => {
                     try {
                         const serverMsg = JSON.parse(data.toString());
                          // Only log if it's not a standard streaming media packet
                          if (!serverMsg.serverContent?.modelTurn?.parts?.some(p => p.inlineData) && !serverMsg.serverContent?.outputTranscription) {
                              console.log('[BRIDGE] Received from Gemini:', JSON.stringify(serverMsg));
                          }
                         // Handle Gemini server voice activity detection (VAD)
                         if (serverMsg.voiceActivity) {
                             if (serverMsg.voiceActivity.type === 'ACTIVITY_START') {
                                 console.log('[BRIDGE] Gemini VAD: ACTIVITY_START detected.');
                             } else if (serverMsg.voiceActivity.type === 'ACTIVITY_END') {
                                 console.log('[BRIDGE] Gemini VAD: ACTIVITY_END detected.');
                             }
                         }

                         // Handle user interruption (barge-in)
                         if (serverMsg.serverContent?.interrupted) {
                             console.log('[BRIDGE] Gemini confirmed interruption. Clearing telephony audio playback buffer immediately...');
                             aiPlaybackEndTime = 0;
                             audioProcessor.clearAiSpeaking();
                             if (wsConnection.readyState === ws.OPEN) {
                                 if (isVobiz && vobizStreamId) {
                                     wsConnection.send(JSON.stringify({
                                         event: 'clearAudio',
                                         streamId: vobizStreamId
                                     }));
                                 } else if (twilioStreamSid) {
                                     wsConnection.send(JSON.stringify({
                                         event: 'clear',
                                         streamSid: twilioStreamSid
                                     }));
                                 }
                             }
                         }

                         // Handle turn or generation completion
                         if (serverMsg.serverContent?.generationComplete || serverMsg.serverContent?.turnComplete) {
                             const remainingPlayoutMs = Math.max(0, aiPlaybackEndTime - Date.now());
                             console.log(`[BRIDGE] Gemini generationComplete. Playout remaining on caller device: ${remainingPlayoutMs}ms`);
                             setTimeout(() => {
                                 geminiGreetingFinished = true;
                             }, remainingPlayoutMs + 300);
                         }

                         // Handle setup complete before sending greeting
                         if (serverMsg.setupComplete) {
                             console.log('[BRIDGE] Gemini Setup Complete received. Injecting greeting turn immediately (250ms audio link settle)...');
                             setTimeout(() => {
                                 sendInitialGreeting();
                             }, 250);
                             return;
                         }

                        // 1. Handle audio chunks from Gemini output (24kHz PCM)
                        if (serverMsg.serverContent?.modelTurn?.parts) {
                            if (!geminiGreetingStarted) {
                                geminiGreetingStarted = true;
                                console.log('[BRIDGE] Gemini AI audio output started.');

                                // Start Smart Call Duration Guardrails (prevents runaway telephony & Gemini costs)
                                if (!wrapUpTimer) {
                                    wrapUpTimer = setTimeout(() => {
                                        if (geminiSocket && geminiSocket.readyState === ws.OPEN) {
                                            console.log('[BRIDGE GUARDRAIL] Call reached 3.5 minutes. Injecting wrap-up cue...');
                                            try {
                                                geminiSocket.send(JSON.stringify({
                                                    clientContent: {
                                                        turns: [{
                                                            role: "user",
                                                            parts: [{ text: "SYSTEM INSTRUCTION: The call has reached 3.5 minutes. Please politely and naturally conclude the conversation now: summarize the key takeaway, confirm that our senior relationship manager will connect with them directly with all details, and say a warm goodbye." }]
                                                        }],
                                                        turnComplete: true
                                                    }
                                                }));
                                            } catch (e) {
                                                console.warn('[BRIDGE GUARDRAIL] Wrap-up cue error:', e.message);
                                            }
                                        }
                                    }, 210 * 1000); // 3.5 minutes
                                }

                                if (!maxDurationTimer) {
                                    maxDurationTimer = setTimeout(() => {
                                        console.log('[BRIDGE GUARDRAIL] Call reached 4.5 minute ceiling. Gracefully terminating...');
                                        if (wsConnection && wsConnection.readyState === ws.OPEN) {
                                            wsConnection.close();
                                        }
                                    }, 270 * 1000); // 4.5 minutes
                                }
                            }
                            // Audio chunk duration is tracked accurately below in line 1552

                            for (const part of serverMsg.serverContent.modelTurn.parts) {
                                // Record agent text transcription
                                if (part.text) {
                                    console.log(`[Gemini Agent]: ${part.text}`);
                                    transcriptTurns.push({ role: 'agent', message: part.text });
                                    checkAgentGoodbyeAndHangup(part.text);
                                }
                                
                                if (part.inlineData && part.inlineData.data) {
                                    const rawPcmBytes = Buffer.from(part.inlineData.data, 'base64');
                                    let pcm24 = new Int16Array(rawPcmBytes.buffer, rawPcmBytes.byteOffset, Math.floor(rawPcmBytes.length / 2));

                                    // Pure, crystal-clear 24kHz studio PCM - zero noise on voice

                                    const chunkDurationMs = Math.round(pcm24.length / 24);
                                    const now = Date.now();
                                    if (aiPlaybackEndTime < now) {
                                        aiPlaybackEndTime = now + chunkDurationMs;
                                    } else {
                                        aiPlaybackEndTime += chunkDurationMs;
                                    }
                                    audioProcessor.markAiSpeakingUntil(aiPlaybackEndTime + 400);

                                    if (isVobiz && wsConnection.readyState === ws.OPEN && vobizStreamId) {
                                        // Downsample 24kHz Gemini audio to 16kHz Linear PCM to perfectly match Vobiz stream specification
                                        const pcm16 = downsample24To16(pcm24);
                                        const pcm16Buf = Buffer.from(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
                                        wsConnection.send(JSON.stringify({
                                            event: 'playAudio',
                                            streamId: vobizStreamId,
                                            media: {
                                                contentType: 'audio/x-l16',
                                                sampleRate: 16000,
                                                payload: pcm16Buf.toString('base64')
                                            }
                                        }));
                                    } else if (wsConnection.readyState === ws.OPEN && twilioStreamSid) {
                                        // Downsample to 8kHz mu-law for Twilio
                                        const pcm8 = downsample24To8(pcm24);
                                        const muLawBytes = Buffer.alloc(pcm8.length);
                                        for (let i = 0; i < pcm8.length; i++) {
                                            muLawBytes[i] = encodeMuLaw(pcm8[i]);
                                        }
                                        const base64MuLaw = muLawBytes.toString('base64');

                                        wsConnection.send(JSON.stringify({
                                            event: 'media',
                                            streamSid: twilioStreamSid,
                                            media: { payload: base64MuLaw }
                                        }));
                                    }
                                }
                            }
                        }

                        // Record agent text transcription from outputTranscription
                        const agentText = serverMsg.serverContent?.outputTranscription?.text;
                        if (agentText) {
                            console.log(`[Gemini Agent]: ${agentText}`);
                            transcriptTurns.push({ role: 'agent', message: agentText });
                            checkAgentGoodbyeAndHangup(agentText);
                        }

                        // Record user text turns if transcribed by Gemini
                        if (serverMsg.serverContent?.userTurn?.parts) {
                            for (const part of serverMsg.serverContent.userTurn.parts) {
                                if (part.text) {
                                    console.log(`[User]: ${part.text}`);
                                    transcriptTurns.push({ role: 'user', message: part.text });
                                }
                            }
                        }

                        // Record user text transcription from inputTranscription
                        const userText = serverMsg.serverContent?.inputTranscription?.text;
                        if (userText) {
                            console.log(`[User]: ${userText}`);
                            transcriptTurns.push({ role: 'user', message: userText });
                        }

                        // 2. Handle function call tool executions (like end_call)
                        if (serverMsg.toolCall?.functionCalls) {
                            for (const call of serverMsg.toolCall.functionCalls) {
                                if (call.name === 'end_call') {
                                    console.log(`[BRIDGE] Gemini triggered tool: end_call.`);
                                    geminiSocket.send(JSON.stringify({
                                        toolResponse: {
                                            functionResponses: [{
                                                name: "end_call",
                                                id: call.id,
                                                response: { success: true }
                                            }]
                                        }
                                    }));
                                    triggerCallHangup('end_call_tool');
                                } else if (call.name === 'search_properties') {
                                    console.log(`[BRIDGE] Gemini triggered live tool: search_properties for lead ${leadId}`, call.args);
                                    // Query Supabase directly without injecting male audio clips

                                    // 2. Query Supabase in parallel
                                    let propertiesList = [];
                                    try {
                                        const queryTerm = (call.args?.query || call.args?.location || call.args?.bhk || '').trim();
                                        let q = supabaseAdmin
                                            .from('properties')
                                            .select('id, title, property_type, price, location, address, configurations, description')
                                            .eq('user_id', effectiveProfileId);

                                        if (queryTerm) {
                                            q = q.or(`title.ilike.%${queryTerm}%,location.ilike.%${queryTerm}%,address.ilike.%${queryTerm}%,description.ilike.%${queryTerm}%`);
                                        }
                                        const { data: matched } = await q.limit(3);
                                        if (matched && matched.length > 0) {
                                            propertiesList = matched.map(p => ({
                                                title: p.title,
                                                type: p.property_type,
                                                price: p.price,
                                                location: p.address || p.location,
                                                description: p.description?.slice(0, 150)
                                            }));
                                        } else {
                                            const { data: general } = await supabaseAdmin
                                                .from('properties')
                                                .select('title, property_type, price, location, address, description')
                                                .eq('user_id', effectiveProfileId)
                                                .limit(2);
                                            propertiesList = general || [];
                                        }
                                    } catch (sErr) {
                                        console.error('[BRIDGE] search_properties DB error:', sErr);
                                    }

                                    geminiSocket.send(JSON.stringify({
                                        toolResponse: {
                                            functionResponses: [{
                                                name: "search_properties",
                                                id: call.id,
                                                response: {
                                                    success: true,
                                                    matching_properties: propertiesList
                                                }
                                            }]
                                        }
                                    }));
                                } else if (call.name === 'get_available_slots') {
                                    console.log(`[BRIDGE] Gemini triggered live tool: get_available_slots for lead ${leadId}`);

                                    geminiSocket.send(JSON.stringify({
                                        toolResponse: {
                                            functionResponses: [{
                                                name: "get_available_slots",
                                                id: call.id,
                                                response: {
                                                    success: true,
                                                    available_slots: ["Tomorrow 11:30 AM", "Tomorrow 4:00 PM", "Saturday 12:00 PM"]
                                                }
                                            }]
                                        }
                                    }));
                                } else if (call.name === 'book_appointment_slot') {
                                    console.log(`[BRIDGE] Gemini triggered live tool: book_appointment_slot for lead ${leadId}`, call.args);
                                    const slotTime = call.args?.slot_time || 'Tomorrow 4:00 PM';
                                    const notes = call.args?.notes || '';
                                    if (leadId) {
                                        try {
                                            await supabaseAdmin
                                                .from('leads')
                                                .update({
                                                    pipeline_stage: 'APPOINTMENT_BOOKED',
                                                    autonomous_status: 'BOOKED',
                                                    notes: `Booked via AI Call: ${slotTime}. Notes: ${notes}`
                                                })
                                                .eq('id', leadId);

                                            await supabaseAdmin.from('lead_history').insert({
                                                lead_id: leadId,
                                                action_type: 'APPOINTMENT_BOOKED',
                                                description: `Appointment slot booked during live AI call: ${slotTime}`
                                            });
                                        } catch (bErr) {
                                            console.error('[BRIDGE] Error saving booking:', bErr);
                                        }
                                    }

                                    geminiSocket.send(JSON.stringify({
                                        toolResponse: {
                                            functionResponses: [{
                                                name: "book_appointment_slot",
                                                id: call.id,
                                                response: {
                                                    success: true,
                                                    confirmed_slot: slotTime
                                                }
                                            }]
                                        }
                                    }));
                                }
                            }
                        }
                    } catch (err) {
                        console.error('[BRIDGE] Error handling Gemini message:', err);
                    }
                });

                geminiSocket.on('error', (err) => {
                    console.error('[BRIDGE] Gemini Socket Error:', err);
                });

                                    geminiSocket.on('close', async (code, reason) => {
                    const reasonStr = reason ? reason.toString() : '';
                    console.log(`[BRIDGE] Gemini Socket closed. Code: ${code}, Reason: ${reasonStr}`);
                    if (reasonStr.includes('prepayment credits') || reasonStr.includes('billing')) {
                        console.error('[BRIDGE] CRITICAL: Google AI Studio prepayment credits are depleted for Gemini Live API!');
                    }
                    // VOICE STABILITY FIX: Do NOT reconnect on transient 1011 errors.
                    // Reconnecting creates a brand new Gemini Live session that has ZERO prior
                    // audio context, causing the autoregressive voice model to start "cold" —
                    // which leads to voice timbre drift (deeper/male voice, American accent).
                    // Instead, gracefully end the call to preserve voice integrity.
                    if (code === 1011 && wsConnection.readyState === ws.OPEN && !isCallHangingUp) {
                        console.warn('[BRIDGE] Transient 1011 received from Gemini Live. Ending call gracefully to prevent voice modulation (cold reconnect would reset voice conditioning).');
                    }
                    if (wsConnection.readyState === ws.OPEN) {
                        wsConnection.close();
                    }
                });
            }

            if (data.event === 'media') {
                const payload = data.media?.payload || data.payload;
                if (geminiReady && geminiSocket && geminiSocket.readyState === ws.OPEN && payload) {
                    let pcm16;
                    if (isVobiz && vobizContentType && vobizContentType.includes('l16')) {
                        // Linear 16-bit PCM (16kHz) directly from Vobiz
                        const rawBytes = Buffer.from(payload, 'base64');
                        pcm16 = new Int16Array(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength / 2);
                    } else {
                        // 8kHz mu-law from Twilio or Vobiz
                        const muLawBytes = Buffer.from(payload, 'base64');
                        const pcm8 = new Int16Array(muLawBytes.length);
                        for (let i = 0; i < muLawBytes.length; i++) {
                            pcm8[i] = decodeMuLaw(muLawBytes[i]);
                        }
                        pcm16 = upsample8To16(pcm8);
                    }

                    // ALWAYS forward real caller audio to Gemini — it needs continuous input
                    // to keep its session alive. The processor detects barge-in and backchannel events.
                    const procRes = audioProcessor.processFrame(pcm16);
                    sendPcmChunkToGemini(procRes.pcmOutput);

                    // If genuine caller barge-in detected during AI speaking, clear telephony buffer
                    if (procRes.bargeIn && wsConnection.readyState === ws.OPEN) {
                        console.log('[BRIDGE] Genuine caller barge-in! Clearing AI audio playback to caller...');
                        aiPlaybackEndTime = 0;
                        audioProcessor.clearAiSpeaking();
                        if (isVobiz && vobizStreamId) {
                            wsConnection.send(JSON.stringify({
                                event: 'clearAudio',
                                streamId: vobizStreamId
                            }));
                        } else if (twilioStreamSid) {
                            wsConnection.send(JSON.stringify({
                                event: 'clear',
                                streamSid: twilioStreamSid
                            }));
                        }
                    }

                    // Bridge-level injected backchannels removed — Gemini prompt handles natural Hinglish conversational nods organically
                }
            }


            if (data.event === 'stop') {
                console.log(`[BRIDGE] Telephony stream stopped (${isVobiz ? 'Vobiz' : 'Twilio'}).`);
                wsConnection.close();
            }
        } catch (err) {
            console.error('[BRIDGE] Error processing stream packet:', err);
        }
    });

     wsConnection.on('close', async (code, reason) => {
        if (ambienceInterval) { clearInterval(ambienceInterval); ambienceInterval = null; }
        clearInterval(pingInterval);
        if (wrapUpTimer) {
            clearTimeout(wrapUpTimer);
            wrapUpTimer = null;
        }
        if (maxDurationTimer) {
            clearTimeout(maxDurationTimer);
            maxDurationTimer = null;
        }
        console.log(`[BRIDGE] Twilio Stream closed. Code: ${code}, Reason: ${reason ? reason.toString() : 'none'}. Performing cleanups and summary logs...`);

        if (geminiSocket && geminiSocket.readyState === ws.OPEN) {
            geminiSocket.close();
        }

        // Set lead call status to completed immediately
        try {
            await supabaseAdmin
                .from('leads')
                .update({ voice_call_status: 'completed' })
                .eq('id', leadId);
        } catch (dbErr) {
            console.error('[BRIDGE] Failed to update lead status:', dbErr);
        }

        // Save Call logs & Transcript summary to lead_history and leads table
        if (transcriptTurns.length > 0) {
            try {
                // Merge consecutive turns of the same role for clean DB storage
                const mergedTurns = [];
                let currentTurn = null;
                for (const turn of transcriptTurns) {
                    if (!turn.message || !turn.message.trim()) continue;
                    const msg = turn.message.trim();
                    const role = turn.role;
                    if (!currentTurn) {
                        currentTurn = { role, message: msg };
                    } else if (currentTurn.role === role) {
                        if (/^[.,!?;:]/.test(msg)) {
                            currentTurn.message += msg;
                        } else {
                            currentTurn.message += ' ' + msg;
                        }
                    } else {
                        mergedTurns.push(currentTurn);
                        currentTurn = { role, message: msg };
                    }
                }
                if (currentTurn) {
                    mergedTurns.push(currentTurn);
                }

                // Compile raw text transcript from merged turns
                const fullTranscript = mergedTurns
                    .map(t => `${t.role === 'user' ? (leadName || 'User') : 'Assistant'}: ${t.message}`)
                    .join('\n');
                
                console.log('[BRIDGE] Conversation Transcript Compiled:\n', fullTranscript);

                let summary = 'Conversation took place via Gemini Voice AI.';
                let bookingTime = null;
                let callbackTime = null;
                let isQualified = false;
                let isInterested = false;
                let leadPriority = null;
                let extractedBudget = null;
                let extractedAnswers = {};
                let extractedAllowAfterHours = false;
                let extractedCallingEnabled = true;

                try {
                    let questionsForPrompt = '';
                    if (activeQuestionsList && activeQuestionsList.length > 0) {
                        questionsForPrompt = activeQuestionsList.map((q, idx) => {
                            const optStr = q.options && q.options.length > 0 ? ` (Options: ${q.options.join(', ')})` : '';
                            return `   Q${idx + 1}: "${q.question}"${optStr}`;
                        }).join('\n');
                    }

                    const nowUtc = new Date();
                    const istDateStr = nowUtc.toLocaleString('en-IN', {
                        timeZone: 'Asia/Kolkata',
                        weekday: 'long',
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                    });

                    const analysisPrompt = `
You are analyzing an audio phone call transcript between an AI real estate voice agent and a prospect.
Here is the transcript:
${fullTranscript}

${questionsForPrompt ? `The AI caller attempted to qualify the prospect on the following campaign questions:
${questionsForPrompt}
` : ''}

CURRENT TIME IN INDIA (IST, Asia/Kolkata, UTC+5:30): ${istDateStr}
(UTC Timestamp: ${nowUtc.toISOString()})

STRICT QUALIFICATION & CLASSIFICATION CRITERIA:
1. "is_interested": boolean (true/false)
   - MUST be TRUE ONLY IF: The prospect explicitly expressed genuine interest in purchasing, investing in, or exploring the property (e.g. actively asked about features, layout, or agreed that this is what they are looking for).
   - MUST be FALSE IF:
     * The prospect stated they have no budget, cannot afford it, or said the price is out of their budget (e.g. ₹12.5 Cr is too much, have only ₹1-2 Cr, no money).
     * The prospect asked to be called back later, said they are busy, driving, in a meeting, or told you to call tomorrow (e.g. "call after 12 pm", "call at 3 pm", "call later"). A CALLBACK REQUEST IS NOT CONFIRMED INTEREST!
     * The prospect said "send details on WhatsApp" to deflect or end the call without confirming interest.
     * The prospect stated they are a broker, agent, or also in the real estate business.
     * The prospect asked for employment, jobs, or work.
     * The prospect asked for free property, free rental, or charity.
     * The prospect hung up quickly, gave only passive "hello / haan / okay" without confirming any interest, or stated wrong number / not interested.
     * The call was answered by an automated voicemail or answering machine.

2. "is_qualified": boolean (true/false)
   - MUST be TRUE ONLY IF: is_interested is TRUE AND the prospect has an adequate budget matching the project (e.g. >= ₹10 Cr for Farmhouses, or >= ₹70L for Aerocity) AND shared specific requirements or readiness.
   - If the prospect stated the price is too high or budget is insufficient, is_qualified MUST be FALSE.
   - If the prospect only asked for a callback, is_qualified MUST be FALSE.

3. "lead_priority": "HOT" | "WARM" | "COLD"
   - "HOT": Prospect explicitly confirmed an in-person physical site visit or confirmed high budget and immediate purchase readiness.
   - "WARM": Prospect confirmed genuine interest in buying the property and asked for specific pricing/inventory details.
   - "COLD": ANY of the following: Requested callback (without prior confirmed interest), said they are busy, price too high, no budget, not interested, job seeker, wrong number, or disconnected.
   CRITICAL NOTE: Merely asking for a callback or saying "call tomorrow" MUST be classified as "COLD", NEVER "WARM"!

4. "booking_time": string or null
   - Return an ISO-8601 string (with +05:30 offset or UTC) ONLY IF the prospect EXPLICITLY agreed to or scheduled a future PHYSICAL IN-PERSON SITE VISIT or IN-PERSON OFFICE MEETING on a specific future day/date (e.g. "Saturday at 11 AM I will come to the site").
   - CRITICAL PROHIBITIONS:
     * NEVER return booking_time for a PHONE CALL or FOLLOW-UP CALL! If the prospect agreed to a phone call tomorrow at 10 AM or 11 AM, booking_time MUST BE NULL and callback_time must be set instead!
     * NEVER return the current call timestamp (${nowUtc.toISOString()})! If no specific future in-person appointment date was confirmed, booking_time MUST be null.

5. "callback_time": string or null
   - Return an ISO-8601 string ONLY IF the prospect asked to be called back at a specific future time (e.g. "call after 12 pm tomorrow", "call at 3 PM", "call in the evening"). Calculate relative to the reference IST time above. Otherwise null.

6. "allow_after_hours": boolean (true/false)
   - true if the prospect explicitly agreed or said it is okay to call them back after 7 PM or at any time.

7. "calling_enabled": boolean (true/false)
   - false if the prospect explicitly requested never to be called again or asked to opt out, otherwise true.

Extract the details as a valid JSON object ONLY. Do NOT use markdown tags, ticks, or backticks:
{
  "summary": "A concise, clean 2-3 sentence paragraph summarizing what transpired. Explicitly mention if the caller was interested, not interested, a job seeker, or requested callback.",
  "is_interested": true/false,
  "is_qualified": true/false,
  "lead_priority": "HOT" | "WARM" | "COLD",
  "callback_time": "ISO-8601 string or null",
  "booking_time": "ISO-8601 string or null",
  "allow_after_hours": true/false,
  "calling_enabled": true/false,
  "extracted_budget": "extracted budget string/number if mentioned (e.g. '₹1.5 Cr', '₹70 Lakhs'), else null",
  "extracted_answers": {
    /* Key-value pairs of answers provided by the prospect, e.g. "property_type": "Commercial Showroom", "budget": "₹1.5 Cr" */
  }
}
`.trim();

                    // Post-call AI analysis: Use DeepSeek v4-flash for all text tasks
                    const dsKey = (process.env.DEEPSEEK_API_KEY || '').replace(/^["']|["']$/g, '').trim();
                    let analysisDone = false;

                    if (dsKey) {
                        try {
                            console.log('[BRIDGE] Analyzing call transcript using DeepSeek v4-flash...');
                            const dsRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${dsKey}`
                                },
                                body: JSON.stringify({
                                    model: 'deepseek-flash',
                                    messages: [
                                        {
                                            role: 'system',
                                            content: 'You are an expert real estate AI CRM call analyst. Return a valid JSON object ONLY. Do not wrap in markdown or backticks.'
                                        },
                                        {
                                            role: 'user',
                                            content: analysisPrompt
                                        }
                                    ],
                                    response_format: { type: 'json_object' }
                                })
                            });

                            if (dsRes.ok) {
                                const dsData = await dsRes.json();
                                const rawText = dsData.choices?.[0]?.message?.content;
                                if (rawText) {
                                    const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
                                    const parsed = JSON.parse(cleanJson);
                                    if (parsed.summary) summary = parsed.summary.trim();
                                    if (parsed.booking_time) bookingTime = parsed.booking_time;
                                    if (parsed.callback_time) callbackTime = parsed.callback_time;
                                    if (parsed.is_interested !== undefined) isInterested = parsed.is_interested === true;
                                    if (parsed.is_qualified !== undefined) isQualified = parsed.is_qualified === true && isInterested;
                                    if (parsed.lead_priority) leadPriority = parsed.lead_priority;
                                    if (parsed.extracted_budget) extractedBudget = parsed.extracted_budget;
                                    if (parsed.allow_after_hours !== undefined) extractedAllowAfterHours = parsed.allow_after_hours === true;
                                    if (parsed.calling_enabled === false) extractedCallingEnabled = false;
                                    if (parsed.extracted_answers && typeof parsed.extracted_answers === 'object') {
                                        extractedAnswers = parsed.extracted_answers;
                                    }
                                    analysisDone = true;
                                    console.log('[BRIDGE] Call evaluation completed successfully with DeepSeek v4-flash!', { isInterested, isQualified, leadPriority, bookingTime });
                                }
                            } else {
                                console.warn('[BRIDGE] DeepSeek call returned non-OK status:', dsRes.status, await dsRes.text());
                            }
                        } catch (dsErr) {
                            console.warn('[BRIDGE] DeepSeek analysis error:', dsErr.message);
                        }
                    }

                    if (!analysisDone) {
                        // Fallback to Gemini 2.5 Flash only if DeepSeek was unreachable
                        try {
                            const apiKeyToUse = profileData?.gemini_api_key || profile?.gemini_api_key || defaultApiKey;
                            const restUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKeyToUse}`;
                            const summaryRes = await fetch(restUrl, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    contents: [{ parts: [{ text: analysisPrompt }] }]
                                })
                            });
                            const summaryData = await summaryRes.json();
                            const rawText = summaryData.candidates?.[0]?.content?.parts?.[0]?.text;
                            if (rawText) {
                                const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
                                const parsed = JSON.parse(cleanJson);
                                if (parsed.summary) summary = parsed.summary.trim();
                                if (parsed.booking_time) bookingTime = parsed.booking_time;
                                if (parsed.callback_time) callbackTime = parsed.callback_time;
                                if (parsed.is_interested !== undefined) isInterested = parsed.is_interested === true;
                                if (parsed.is_qualified !== undefined) isQualified = parsed.is_qualified === true && isInterested;
                                if (parsed.lead_priority) leadPriority = parsed.lead_priority;
                                if (parsed.extracted_budget) extractedBudget = parsed.extracted_budget;
                                if (parsed.allow_after_hours !== undefined) extractedAllowAfterHours = parsed.allow_after_hours === true;
                                if (parsed.calling_enabled === false) extractedCallingEnabled = false;
                                if (parsed.extracted_answers && typeof parsed.extracted_answers === 'object') {
                                    extractedAnswers = parsed.extracted_answers;
                                }
                            }
                        } catch (geminiErr) {
                            console.error('[BRIDGE] Gemini fallback analysis failed:', geminiErr.message);
                        }
                    }
                } catch (sumErr) {
                    console.error('[BRIDGE] Auto-analysis failed:', sumErr);
                }

                // ──────────────────────────────────────────────────────────
                // VOBIZ RECORDING FETCH: Actively fetch, download & upload
                // the call recording from Vobiz Recording API.
                // ──────────────────────────────────────────────────────────
                let freshRecordingUrl = null;

                // Step 1: Check if Vobiz status callback already saved a recording URL to the lead
                try {
                    const { data: freshLead } = await supabaseAdmin
                        .from('leads')
                        .select('voice_recording_url')
                        .eq('id', leadId)
                        .single();
                    freshRecordingUrl = freshLead?.voice_recording_url || null;
                } catch (freshErr) {
                    console.warn('[BRIDGE] Failed to re-fetch fresh lead recording URL:', freshErr);
                }

                // Step 2: If no recording URL yet AND this is a Vobiz call, actively fetch from Vobiz Recording API
                if (!freshRecordingUrl && isVobiz && vobizCallId) {
                    console.log(`[BRIDGE] No recording URL found yet for Vobiz call ${vobizCallId}. Actively fetching from Vobiz Recording API...`);
                    const recAuthId = queryVobizAuthId || (profileData?.business_info?.kyc_data?.vobizSubAuthId || profileData?.voice_vobiz_auth_id) || process.env.VOBIZ_AUTH_ID || 'MA_HOSGFZ86';
                    const recAuthToken = queryVobizAuthToken || (profileData?.business_info?.voice_vobiz_auth_token || profileData?.voice_vobiz_auth_token) || process.env.VOBIZ_AUTH_TOKEN || 'RGoIxkVVdY9uRBngaoUSP9Jy0ylLfptistrm2ijpvtM9Yusx6sOjACyOj15FUlzU';

                    for (let recAttempt = 1; recAttempt <= 3; recAttempt++) {
                        try {
                            // Wait for Vobiz to finalize audio processing (3s first attempt, 5s subsequent)
                            const waitMs = recAttempt === 1 ? 3000 : 5000;
                            await new Promise(r => setTimeout(r, waitMs));

                            const recListUrl = `https://api.vobiz.ai/api/v1/Account/${recAuthId}/Recording/?call_uuid=${vobizCallId}&limit=10`;
                            const recListRes = await fetch(recListUrl, {
                                headers: {
                                    'X-Auth-ID': recAuthId,
                                    'X-Auth-Token': recAuthToken
                                }
                            });

                            if (recListRes.ok) {
                                const recListData = await recListRes.json().catch(() => ({}));
                                const objects = recListData.objects || (recListData.recording_url ? [recListData] : []);
                                
                                let bestBuffer = null;
                                let bestRecUrl = null;

                                for (const recObj of objects) {
                                    const vobizRecUrl = recObj?.recording_url || recObj?.url || recObj?.mp3_url || null;
                                    if (!vobizRecUrl) continue;
                                    try {
                                        const audioRes = await fetch(vobizRecUrl, {
                                            headers: {
                                                'X-Auth-ID': recAuthId,
                                                'X-Auth-Token': recAuthToken
                                            }
                                        });
                                        if (audioRes.ok) {
                                            const buf = Buffer.from(await audioRes.arrayBuffer());
                                            if (buf.byteLength > 5000 && (!bestBuffer || buf.byteLength > bestBuffer.byteLength)) {
                                                bestBuffer = buf;
                                                bestRecUrl = vobizRecUrl;
                                            }
                                        }
                                    } catch (dErr) {}
                                }

                                if (bestBuffer && bestRecUrl) {
                                    console.log(`[BRIDGE] Found valid Vobiz recording (${bestBuffer.byteLength} bytes) on attempt ${recAttempt}: ${bestRecUrl}. Uploading...`);
                                    const storagePath = `${leadId}/vobiz_${vobizCallId}_${Date.now()}.mp3`;

                                    const { error: uploadErr } = await supabaseAdmin.storage
                                        .from('lead-voice-recordings')
                                        .upload(storagePath, bestBuffer, {
                                            contentType: 'audio/mpeg',
                                            upsert: true
                                        });

                                    if (!uploadErr) {
                                        const { data: pubData } = supabaseAdmin.storage
                                            .from('lead-voice-recordings')
                                            .getPublicUrl(storagePath);
                                        freshRecordingUrl = pubData?.publicUrl || null;
                                        console.log(`[BRIDGE] ✅ Vobiz recording uploaded to Supabase for lead ${leadId}: ${freshRecordingUrl}`);
                                    } else {
                                        console.warn('[BRIDGE] Supabase storage upload error for Vobiz recording:', uploadErr);
                                        freshRecordingUrl = bestRecUrl;
                                    }
                                    break; // Successfully got recording, stop retrying
                                } else {
                                    console.log(`[BRIDGE] Vobiz recording not ready yet (attempt ${recAttempt}/3). Retrying...`);
                                }
                            } else {
                                console.warn(`[BRIDGE] Vobiz Recording API returned ${recListRes.status} on attempt ${recAttempt}`);
                            }
                        } catch (recFetchErr) {
                            console.warn(`[BRIDGE] Vobiz recording fetch attempt ${recAttempt} error:`, recFetchErr.message);
                        }
                    }

                    if (!freshRecordingUrl) {
                        console.warn(`[BRIDGE] ⚠️ Could not retrieve Vobiz recording after 3 attempts for call ${vobizCallId}`);
                    }
                }

                // Build lead update payload with summary, transcript, stage transition, and qualification answers
                const updatePayload = {
                    voice_call_status: 'completed',
                    voice_call_summary: summary,
                    voice_call_transcript: mergedTurns
                };

                if (summary && String(summary).trim().length > 0) {
                    updatePayload.summary = summary;
                    const dateStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                    const callNote = `[🎙️ AI Voice Call - ${dateStr}]: ${summary}`;
                    updatePayload.notes = lead?.notes ? `${callNote}\n\n${lead.notes}` : callNote;
                }

                // Attach recording URL to lead if available
                if (freshRecordingUrl) {
                    updatePayload.voice_recording_url = freshRecordingUrl;
                    console.log(`[BRIDGE] Recording URL attached to lead ${leadId}: ${freshRecordingUrl}`);
                }

                // Merge extracted answers into lead.custom_fields
                let currentCf = lead?.custom_fields || {};
                if (typeof currentCf === 'string') {
                    try { currentCf = JSON.parse(currentCf); } catch (e) { currentCf = {}; }
                }
                const mergedCf = { ...currentCf };

                if (summary && String(summary).trim().length > 0) {
                    mergedCf.last_followup_remark = summary;
                    mergedCf.last_followup_at = new Date().toISOString();
                    mergedCf.last_followup_type = 'AI Voice Call';
                }

                if (extractedAnswers && typeof extractedAnswers === 'object') {
                    // Copy raw key-values
                    Object.entries(extractedAnswers).forEach(([k, v]) => {
                        if (v !== null && v !== undefined && String(v).trim().length > 0) {
                            mergedCf[k] = v;
                            const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30);
                            mergedCf[cleanK] = v;
                        }
                    });

                    // Explicitly map against activeQuestionsList so CRM Question Flow highlights as Answered
                    if (activeQuestionsList && activeQuestionsList.length > 0) {
                        activeQuestionsList.forEach((q, idx) => {
                            const qKey = typeof q === 'object' && q.field_name ? q.field_name : (idx === 0 ? 'property_type' : idx === 1 ? 'budget' : idx === 2 ? 'timeline' : `custom_q_${idx}`);
                            const qText = typeof q === 'string' ? q : (q.question || q.text || '');
                            const qClean = qText.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30);

                            for (const [ansK, ansV] of Object.entries(extractedAnswers)) {
                                if (!ansV) continue;
                                const ansKLower = ansK.toLowerCase();
                                const isKeyMatch = ansKLower === qKey.toLowerCase() || ansKLower === qClean;
                                const isTextMatch = qText.toLowerCase().includes(ansKLower) || ansKLower.includes(qClean);
                                const isSemanticMatch = (ansKLower.includes('budget') && qKey.includes('budget')) ||
                                                        (ansKLower.includes('property') && qKey.includes('property')) ||
                                                        (ansKLower.includes('time') && qKey.includes('time'));

                                if (isKeyMatch || isTextMatch || isSemanticMatch) {
                                    mergedCf[qKey] = ansV;
                                    mergedCf[qClean] = ansV;
                                    if (qKey.includes('property')) mergedCf.interested_property = ansV;
                                    if (qKey.includes('budget') || ansKLower.includes('budget')) {
                                        mergedCf.budget = ansV;
                                        if (!extractedBudget) extractedBudget = ansV;
                                    }
                                }
                            }
                        });
                    }
                }

                if (extractedBudget) {
                    updatePayload.budget = String(extractedBudget);
                    mergedCf.budget = String(extractedBudget);
                }

                if (leadPriority) {
                    mergedCf.lead_priority = leadPriority;
                }

                // Check answered count against active questions
                let answeredCount = 0;
                if (activeQuestionsList && activeQuestionsList.length > 0) {
                    activeQuestionsList.forEach((q, idx) => {
                        const qKey = typeof q === 'object' && q.field_name ? q.field_name : (idx === 0 ? 'property_type' : idx === 1 ? 'budget' : idx === 2 ? 'timeline' : `custom_q_${idx}`);
                        const qText = typeof q === 'string' ? q : (q.question || q.text || '');
                        const qClean = qText.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30);
                        const val = mergedCf[qKey] || mergedCf[qClean] || (qKey.includes('property') ? mergedCf.property_type : undefined) || (qKey.includes('budget') ? mergedCf.budget : undefined);
                        if (val && String(val).trim().length > 0) answeredCount++;
                    });
                    if (answeredCount > 0 && answeredCount >= activeQuestionsList.length) {
                        mergedCf.qualification_completed = true;
                    }
                }

                mergedCf.is_interested = isInterested;
                mergedCf.is_qualified = isQualified;
                mergedCf.allow_after_hours = extractedAllowAfterHours;
                mergedCf.calling_enabled = extractedCallingEnabled;
                updatePayload.custom_fields = mergedCf;

                let isValidBooking = false;
                if (bookingTime) {
                    const bDate = new Date(bookingTime);
                    // Must be a valid date at least 15 minutes in the future
                    if (!isNaN(bDate.getTime()) && bDate.getTime() > Date.now() + (15 * 60 * 1000)) {
                        const sumLower = (summary || '').toLowerCase();
                        const isJustCall = sumLower.includes('follow-up call') || sumLower.includes('phone call') || sumLower.includes('call back') || sumLower.includes('call tomorrow') || sumLower.includes('consultation call') || sumLower.includes('discuss on call') || sumLower.includes('collaborate');
                        if (isJustCall) {
                            console.log(`[BRIDGE] Reclassifying booking_time "${bookingTime}" to callback_time because it is a phone call: ${summary}`);
                            callbackTime = bookingTime;
                            bookingTime = null;
                        } else {
                            console.log(`[BRIDGE] Detected VALID future in-person site visit booking from call: ${bookingTime}. Updating stage to Appointment Booked!`);
                            updatePayload.status = 'Appointment Booked';
                            updatePayload.pipeline_stage = 'Appointment Booked';
                            updatePayload.booked_time = bDate.toISOString();
                            isValidBooking = true;
                            mergedCf.is_interested = true;
                            mergedCf.is_qualified = true;
                        }
                    } else {
                        console.warn(`[BRIDGE] Rejected invalid/immediate booking time "${bookingTime}". Not a future appointment.`);
                        bookingTime = null;
                    }
                }

                if (!isValidBooking && callbackTime) {
                    console.log(`[BRIDGE] Detected prospect requested callback time: ${callbackTime}`);
                    try {
                        const reqDate = new Date(callbackTime);
                        if (!isNaN(reqDate.getTime()) && reqDate.getTime() > Date.now() + (5 * 60 * 1000)) {
                            const { scheduledTime } = computeValidCallingSlot(reqDate, 'Asia/Kolkata');
                            updatePayload.voice_call_scheduled_at = scheduledTime.toISOString();
                            updatePayload.voice_call_status = 'scheduled_callback';
                        }
                    } catch (cbErr) {
                        console.error('[BRIDGE] Error parsing callback time:', cbErr);
                    }
                }

                if (!isValidBooking) {
                    // CRITICAL: Leads must remain in Fresh section ('New Lead') so human telecallers can contact them!
                    // Even if AI caller or WhatsApp bot contacted/followed up, keep in Fresh unless an actual appointment was booked.
                    const isFresh = !lead || !lead.pipeline_stage || ['new', 'new lead', 'fresh', 'uncontacted', 'unprocessed'].includes((lead.pipeline_stage || '').trim().toLowerCase()) || ['new', 'new lead', 'fresh'].includes((lead.status || '').trim().toLowerCase());
                    if (isFresh) {
                        updatePayload.status = lead?.status || 'New Lead';
                        updatePayload.pipeline_stage = lead?.pipeline_stage || 'New Lead';
                    } else {
                        if (lead?.status) updatePayload.status = lead.status;
                        if (lead?.pipeline_stage) updatePayload.pipeline_stage = lead.pipeline_stage;
                    }
                }

                try {
                    await supabaseAdmin
                        .from('leads')
                        .update(updatePayload)
                        .eq('id', leadId);
                    console.log('[BRIDGE] Leads table summary, transcript, answers, and pipeline stage updated successfully!');

                    // Post-call notifications for Admin (WhatsApp + Email) and lead score calculation
                    try {
                        const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://app.nobogent.com';
                        const notifyUrl = `${appBaseUrl}/api/voice/post-call-notify`;
                        
                        fetch(notifyUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                leadId,
                                profileId: profileData?.id || profileId,
                                bookingTime,
                                callbackTime,
                                isQualified,
                                isInterested,
                                leadPriority,
                                summary,
                                extractedAnswers,
                                extractedBudget,
                                skipProspectWhatsApp: true
                            })
                        }).catch(nErr => console.warn('[BRIDGE] Post-call notify fetch error:', nErr.message));

                        fetch(`${appBaseUrl}/api/crm/recalculate-score`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ leadId, qualifyingQuestions: activeQuestionsList })
                        }).catch(() => {});
                    } catch (scErr) {}
                } catch (leadErr) {
                    console.error('[BRIDGE] Failed to save transcript/summary to lead:', leadErr);
                }

                if (callbackTime) {
                    try {
                        const reqDate = new Date(callbackTime);
                        if (!isNaN(reqDate.getTime())) {
                            const { scheduledTime } = computeValidCallingSlot(reqDate, 'Asia/Kolkata');
                            await supabaseAdmin.from('lead_history').insert({
                                lead_id: leadId,
                                action_type: 'REMARK',
                                description: `🕒 Prospect requested callback. Scheduled automated AI call for ${scheduledTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} (IST).`
                            });
                            console.log(`[BRIDGE] Successfully logged scheduled callback for lead ${leadId} at ${scheduledTime.toISOString()}`);
                        }
                    } catch (histCbErr) {
                        console.error('[BRIDGE] Failed to log callback history:', histCbErr);
                    }
                }

                if (bookingTime && (profileData?.id || profileId)) {
                    try {
                        const effectiveOwnerId = profileData?.id || profileId;
                        await supabaseAdmin.from('calendar_events').insert({
                            user_id: effectiveOwnerId,
                            lead_id: leadId,
                            title: `Appointment with ${leadName}`,
                            start_time: bookingTime,
                            end_time: new Date(new Date(bookingTime).getTime() + 30 * 60000).toISOString(),
                            status: 'scheduled',
                            source: 'voice_ai'
                        });
                        console.log('[BRIDGE] Calendar event inserted successfully for booking:', bookingTime);
                    } catch (bErr) {
                        console.error('[BRIDGE] Calendar insert error:', bErr);
                    }
                }

                // Insert into Supabase lead_history
                const historyData = {
                    summary,
                    recording_url: freshRecordingUrl || lead?.voice_recording_url || null,
                    transcript: mergedTurns
                };

                const effectiveOwner = profileData?.id || profileId || lead?.user_id;
                const historyPayload = {
                    lead_id: leadId,
                    action_type: 'REMARK',
                    description: `🎙️ CALL_JSON:${JSON.stringify(historyData)}`
                };
                if (effectiveOwner) {
                    historyPayload.user_id = effectiveOwner;
                }

                const { error: histErr } = await supabaseAdmin
                    .from('lead_history')
                    .insert(historyPayload);

                if (histErr) {
                    console.error('[BRIDGE] Insert lead_history failed:', histErr);
                } else {
                    console.log('[BRIDGE] Call history inserted successfully!');
                }
            } catch (err) {
                console.error('[BRIDGE] Transcript summary insert error:', err);
            }
        }
    });
});
