const fs = require('fs');
const path = require('path');

const serverJsPath = path.join(__dirname, '..', 'voice-bridge', 'server.js');
let content = fs.readFileSync(serverJsPath, 'utf8');

// 1. Remove send_whatsapp_info tool execution block
const waToolStart = "} else if (call.name === 'send_whatsapp_info') {";
const waToolEnd = "geminiSocket.send(JSON.stringify({\n                                        toolResponse: {\n                                            functionResponses: [{\n                                                name: \"send_whatsapp_info\",\n                                                id: call.id,\n                                                response: {\n                                                    success: true,\n                                                    status: 'handshake_sent',\n                                                    instruction_for_agent: instructionText\n                                                }\n                                            }]\n                                        }\n                                    }));\n                                }";

// Let's use regex to reliably match and cut out send_whatsapp_info handler
const sendWaBlockRegex = /\} else if \(call\.name === ['"]send_whatsapp_info['"]\) \{[\s\S]*?name:\s*['"]send_whatsapp_info['"][\s\S]*?\}\);\s*\}/;
if (sendWaBlockRegex.test(content)) {
    content = content.replace(sendWaBlockRegex, '}');
    console.log('Successfully removed send_whatsapp_info execution block.');
} else {
    console.warn('send_whatsapp_info block not found via regex, checking CRLF vs LF...');
}

// 2. Replace 3.5 min guardrail text
content = content.replace(
    'confirm you are sending the brochure and details on their WhatsApp, and say a warm goodbye.',
    'confirm that our senior relationship manager will connect with them directly with all details, and say a warm goodbye.'
);

// 3. Update buildGeminiSetupConfig language logic and systemInstruction
// Find start of language block:
const targetLangStart = '    const campGuidanceLower = campaignGuidance.toLowerCase();';
const targetLangEnd = '    const validVoiceNames = [\'Aoede\', \'Kore\', \'Puck\', \'Charon\', \'Fenrir\'];';

const newLangCode = `    // Extract profile business_info for default calling language
    let bi = {};
    try {
        if (profile?.business_info && typeof profile.business_info === 'string') {
            bi = JSON.parse(profile.business_info);
        } else if (profile?.business_info && typeof profile.business_info === 'object') {
            bi = profile.business_info;
        }
    } catch (e) {}

    const campGuidanceLower = campaignGuidance.toLowerCase();
    
    // Determine effective calling language:
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
        ? \`GENDER IDENTITY (FEMALE): You are Sahana, a warm, professional, distinctly FEMALE customer relationship representative. You MUST speak in a polite, feminine, natural Indian English tone. NEVER sound male or robotic.\`
        : (isFemale
            ? \`GENDER IDENTITY (FEMALE): You are Priya, a FEMALE representative. In Hindi, Hinglish, Punjabi, and Indian languages, you MUST ALWAYS use feminine verb forms and grammatical endings (e.g. "Main \${companyName} se baat kar RAHI hoon", "Main aapki help kar SAKTI hoon"). NEVER use masculine endings.\`
            : \`GENDER IDENTITY (MALE): You are a MALE representative. In Hindi, Hinglish, Punjabi, and Indian languages, you MUST ALWAYS use masculine verb forms and grammatical endings.\`);

    const backchannelAck = isFemale
        ? \`"Haan ji", "Ahan", "Hmm", "Ji bilkul", "Achha", "Samajh rahi hoon"\`
        : \`"Haan ji", "Ahan", "Hmm", "Ji bilkul", "Achha", "Samajh raha hoon"\`;

    let languageInstruction;
    let effectiveAck = backchannelAck;

    if (defaultCallingLang === 'english') {
        languageInstruction = \`CRITICAL ACCENT, PRONUNCIATION & LANGUAGE MANDATE:
- MANDATORY STARTING LANGUAGE: You MUST speak in NATURAL, POLITE, COURTEOUS URBAN INDIAN ENGLISH (South Indian / Bangalore / Mumbai professional cadence, warm clear voice).
- STRICT ACCENT DIRECTIVE (NO AMERICAN ACCENT): You MUST speak with an authentic, professional Indian English accent (crisp non-rhotic pronunciation, warm Indian intonation and inflection, clear syllables). NEVER USE AN AMERICAN, BRITISH, OR WESTERN ACCENT.
- DYNAMIC MULTILINGUAL ADAPTATION: You are fully multilingual. If the caller speaks in Hindi, Hinglish, Punjabi, Kannada, Telugu, Tamil, Marathi, Gujarati, Bengali, or another language, or asks to converse in any language, you MUST IMMEDIATELY and effortlessly switch 100% to their preferred language from your very next turn and continue the rest of the conversation comfortably and fluently in that language!
- AUTHENTIC PRONUNCIATION: Pronounce Indian names and words authentically.\`;
        effectiveAck = \`"Yes", "Sure", "Right", "Understood", "Definitely", "Absolutely", "Hmm"\`;
    } else if (defaultCallingLang === 'kannada') {
        languageInstruction = \`LANGUAGE REQUIREMENT:
- MANDATORY STARTING LANGUAGE: YOU MUST BEGIN THE CALL DIRECTLY IN NATURAL, POLITE, FLUENT KANNADA (Karnataka / Bengaluru conversational cadence).
- DYNAMIC MULTILINGUAL ADAPTATION: You are fully multilingual. If the caller replies in English, Hindi, Hinglish, Telugu, Tamil, or asks to speak in another language, IMMEDIATELY switch smoothly to their preferred language and continue the rest of the conversation in that language without any hesitation!\`;
        effectiveAck = isFemale ? \`"Haudu", "Sari", "Khanditha", "Ahan", "Hmm", "Samajh rahi hoon"\` : \`"Haudu", "Sari", "Khanditha", "Ahan", "Hmm", "Samajh raha hoon"\`;
    } else if (defaultCallingLang === 'punjabi') {
        languageInstruction = \`LANGUAGE REQUIREMENT:
- MANDATORY STARTING LANGUAGE: YOU MUST BEGIN THE CALL DIRECTLY IN NATURAL, RESPECTFUL, CONVERSATIONAL PUNJABI (warm, polite everyday Punjabi).
- DYNAMIC MULTILINGUAL ADAPTATION: You are fully multilingual. If the caller speaks in Hindi, Hinglish, English, or another language, or asks to speak in another language, IMMEDIATELY switch smoothly to their preferred language and continue comfortably and fluently!\`;
        effectiveAck = isFemale ? \`"Haan ji", "Ahan", "Ji bilkul", "Sahi gal hai", "Samajh rahi haan"\` : \`"Haan ji", "Ahan", "Ji bilkul", "Sahi gal hai", "Samajh reha haan"\`;
    } else if (defaultCallingLang === 'hindi') {
        languageInstruction = \`LANGUAGE REQUIREMENT:
- MANDATORY STARTING LANGUAGE: YOU MUST BEGIN THE CALL IN CLEAN, NATURAL, POLITE HINDI (everyday conversational Hindi, warm and courteous).
- DYNAMIC MULTILINGUAL ADAPTATION: You are fully multilingual. If the caller speaks in English, Hinglish, Punjabi, or another language, IMMEDIATELY switch smoothly to their preferred language and continue the call comfortably!\`;
        effectiveAck = backchannelAck;
    } else if (defaultCallingLang === 'telugu') {
        languageInstruction = \`LANGUAGE REQUIREMENT:
- MANDATORY STARTING LANGUAGE: YOU MUST BEGIN THE CALL IN NATURAL, POLITE, FLUENT TELUGU (warm Andhra / Telangana conversational cadence).
- DYNAMIC MULTILINGUAL ADAPTATION: You are fully multilingual. If the caller speaks in English, Hindi, Hinglish, or another language, IMMEDIATELY switch smoothly to their preferred language and continue comfortably!\`;
        effectiveAck = \`"Avunu", "Sare", "Arthamaindi", "Kandithamga", "Hmm"\`;
    } else if (defaultCallingLang === 'tamil') {
        languageInstruction = \`LANGUAGE REQUIREMENT:
- MANDATORY STARTING LANGUAGE: YOU MUST BEGIN THE CALL IN NATURAL, POLITE, FLUENT TAMIL (warm Chennai / Tamil Nadu conversational cadence).
- DYNAMIC MULTILINGUAL ADAPTATION: You are fully multilingual. If the caller speaks in English, Hindi, or another language, IMMEDIATELY switch smoothly to their preferred language and continue comfortably!\`;
        effectiveAck = \`"Aam", "Sari", "Purinjadhu", "Kandippa", "Hmm"\`;
    } else if (defaultCallingLang === 'marathi') {
        languageInstruction = \`LANGUAGE REQUIREMENT:
- MANDATORY STARTING LANGUAGE: YOU MUST BEGIN THE CALL IN NATURAL, POLITE, FLUENT MARATHI (warm Maharashtra conversational cadence).
- DYNAMIC MULTILINGUAL ADAPTATION: You are fully multilingual. If the caller speaks in Hindi, English, Hinglish, or another language, IMMEDIATELY switch smoothly to their preferred language and continue comfortably!\`;
        effectiveAck = \`"Ho", "Barobar", "Kallan", "Nakkich", "Hmm"\`;
    } else if (defaultCallingLang === 'gujarati') {
        languageInstruction = \`LANGUAGE REQUIREMENT:
- MANDATORY STARTING LANGUAGE: YOU MUST BEGIN THE CALL IN NATURAL, POLITE, FLUENT GUJARATI (warm Gujarat conversational cadence).
- DYNAMIC MULTILINGUAL ADAPTATION: You are fully multilingual. If the caller speaks in Hindi, English, Hinglish, or another language, IMMEDIATELY switch smoothly to their preferred language and continue comfortably!\`;
        effectiveAck = \`"Ha", "Barobar", "Samjayu", "Chokkas", "Hmm"\`;
    } else if (defaultCallingLang === 'bengali') {
        languageInstruction = \`LANGUAGE REQUIREMENT:
- MANDATORY STARTING LANGUAGE: YOU MUST BEGIN THE CALL IN NATURAL, POLITE, FLUENT BENGALI (warm Kolkata conversational cadence).
- DYNAMIC MULTILINGUAL ADAPTATION: You are fully multilingual. If the caller speaks in Hindi, English, Hinglish, or another language, IMMEDIATELY switch smoothly to their preferred language and continue comfortably!\`;
        effectiveAck = \`"Haa", "Thik ache", "Bujhte perechi", "Nischoy", "Hmm"\`;
    } else {
        // Default to Hinglish
        languageInstruction = \`LANGUAGE REQUIREMENT:
- DEFAULT TO NATURAL, FLUENT HINGLISH (conversational mix of Hindi and English, written in Latin script).
- DYNAMIC MULTILINGUAL ADAPTATION: You are fully multilingual. If the caller speaks in English, Hindi, Punjabi, Kannada, Telugu, Tamil, Marathi, Gujarati, Bengali, or another regional language, or asks to converse in any language, IMMEDIATELY switch to their language and converse comfortably, fluently, and naturally!\`;
        effectiveAck = backchannelAck;
    }

    const conversationNods = defaultCallingLang === 'english'
        ? \`"Hmm...", "Yes...", "Right...", "Definitely...", or "Understood..."\`
        : \`"Hmm...", "Ahan...", "Haan ji...", "Achha...", or "Ji bilkul..."\`;

    const whatsappProhibitionDirective = \`
CRITICAL DIRECTIVE — ABSOLUTE PROHIBITION ON WHATSAPP:
- Under NO circumstances should you EVER say, promise, or imply that you or an AI will send info, brochures, or messages on WhatsApp!
- If the prospect asks: "Send details on WhatsApp", "WhatsApp me", "WhatsApp kar do", or similar:
  NEVER agree to send it on WhatsApp yourself.
  Instead, politely say:
  \${defaultCallingLang === 'english'
    ? '"Certainly, I\\'ll connect you with our senior relationship manager who will get in touch with you directly and share all the details."'
    : '"Ji bilkul sir, main hamare senior relationship manager ko bol deti hoon, woh aapse directly connect karke saari details share kar denge."'
  }
  Then smoothly transition to confirm their preferred time for the relationship manager to call or say a polite goodbye.\`;

    const defaultFlow = \`
KEY OBJECTIVE & CALL FLOW (3-STEP INDUSTRY AGNOSTIC TEMPLATE):
1. STEP 1: GREETING & ENQUIRY CONFIRMATION
   - The opening greeting has already been delivered asking if they are still looking into \${targetProduct}.
   - IF CALLER SAYS "HELLO?", "CAN YOU HEAR ME?", OR "WHO IS THIS?":
     Respond warmly and concisely: "Yes, hi! I can hear you clearly. I'm calling from \${companyName} regarding your enquiry for \${targetProduct}."
     -> STOP TALKING IMMEDIATELY AND WAIT FOR THEM TO CONFIRM.

2. STEP 2: DISCOVERY (WHEN CALLER CONFIRMS INTEREST)
   - When caller says "Yes / Go ahead / Tell me / Sure":
   - Share a crisp 1-sentence value proposition of \${targetProduct}.
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
\`;

    const voiceLockDirective = \`
ABSOLUTE VOICE LOCK & FEMININE TIMBRE (CRITICAL — NEVER VIOLATE):
- You MUST maintain your bright, warm, distinctly feminine voice (Aoede timbre, natural pitch range 190-215 Hz) from your very first word until the call ends.
- STRICT PROHIBITION AGAINST TIMBRE DRIFT: NEVER drop into a deeper, heavier, flat, or masculine vocal fry at ANY point in the call, especially during closing turns.
- NEVER adopt an American, British, or Western accent. Maintain authentic Urban Indian cadence.
- Every single turn, whether greeting, answering a question, or saying goodbye, MUST sound identically pleasant, bright, and feminine.
- Your voice identity is LOCKED for the entire duration of this call session. No exceptions.\`;

    const systemInstruction = \`
You are an expert, professional outbound AI relationship representative calling on behalf of "\${companyName}".
You are speaking directly over the phone with \${leadName}.

\${voiceLockDirective}

\${languageInstruction}

\${whatsappProhibitionDirective}

\${genderGrammarInstruction}

\${campaignGuidance ? \`\${campaignGuidance}\\n\\n\${whatsappProhibitionDirective}\\n\` : defaultFlow}

\${catalogueInfo}
\${formQuestionsSummary}
\${resolvedQuestionsInstruction}
\`.trim();
`;

const startIndex = content.indexOf(targetLangStart);
const endIndex = content.indexOf(targetLangEnd);

if (startIndex !== -1 && endIndex !== -1) {
    content = content.substring(0, startIndex) + newLangCode + '\n' + content.substring(endIndex);
    console.log('Successfully updated buildGeminiSetupConfig language and instructions.');
} else {
    console.error('Could not find start/end anchor for language block.');
}

// 4. In buildGeminiSetupConfig return object, include defaultLanguage
content = content.replace(
    '        systemInstruction,\n        setupPayload,',
    '        defaultLanguage: defaultCallingLang,\n        systemInstruction,\n        setupPayload,'
);

// 5. In sendInitialGreeting, use defaultLanguage from sessionConfig
const oldGreetingLogic = `                    const isIndianEn = campPromptLower.includes('indian accent english') || 
                                       campPromptLower.includes('indian english') || 
                                       campPromptLower.includes('indian accent') || 
                                       campaign?.audience_filter?.language === 'english' || 
                                       (openGreeting && (openGreeting.toLowerCase().startsWith('hello') || openGreeting.toLowerCase().startsWith('hi '))) ||
                                       (!campPromptLower.includes('kannada') && !campPromptLower.includes('default language: hinglish') && !campPromptLower.includes('default language: hindi'));

                    if (!openGreeting) {
                        if (isIndianEn) {
                            const safeEnName = safeName ? safeName : 'there';
                            openGreeting = \`Hi \${safeEnName}, this is Sahana from \${safeCompanyName}. I saw you recently enquired about our \${safeProduct} on Facebook — just wanted to check if you're still looking into this?\`;
                        } else if (campPromptLower.includes('kannada') || campPromptLower.includes('ಕನ್ನಡ') || campaign?.audience_filter?.language === 'kannada') {
                            const safeKnName = safeName ? \`\${safeName} avare\` : 'avare';
                            openGreeting = \`Namaskara \${safeKnName}, naanu \${safeCompanyName} inda call maadtha iddini. Neevu Facebook alli namma \${safeProduct} bagge enquiry maadidri — adhara bagge explore maadtha iddeera antha check maadbekittu.\`;
                        } else {
                            openGreeting = \`Haan ji \${nameGreeting}, main \${safeCompanyName} se baat kar rahi hoon. Aapne Facebook par hamare \${safeProduct} ke baare mein enquiry ki thi — bas check karna tha kya aap abhi bhi iske baare mein explore kar rahe hain?\`;
                        }
                    }`;

const newGreetingLogic = `                    let effectiveLang = sessionConfig?.defaultLanguage || 'hinglish';
                    if (campPromptLower.includes('kannada')) effectiveLang = 'kannada';
                    else if (campPromptLower.includes('punjabi')) effectiveLang = 'punjabi';
                    else if (campPromptLower.includes('hindi')) effectiveLang = 'hindi';
                    else if (campPromptLower.includes('english')) effectiveLang = 'english';

                    if (!openGreeting) {
                        if (effectiveLang === 'english') {
                            const safeEnName = safeName ? safeName : 'there';
                            openGreeting = \`Hi \${safeEnName}, this is from \${safeCompanyName}. I saw you recently enquired about our \${safeProduct} on Facebook — just wanted to check if you're still looking into this?\`;
                        } else if (effectiveLang === 'kannada') {
                            const safeKnName = safeName ? \`\${safeName} avare\` : 'avare';
                            openGreeting = \`Namaskara \${safeKnName}, naanu \${safeCompanyName} inda call maadtha iddini. Neevu Facebook alli namma \${safeProduct} bagge enquiry maadidri — adhara bagge explore maadtha iddeera antha check maadbekittu.\`;
                        } else if (effectiveLang === 'punjabi') {
                            openGreeting = \`Sat Sri Akal \${nameGreeting}, main \${safeCompanyName} ton bol rahi haan. Tussi Facebook par saade \${safeProduct} baare enquiry kiti si — bas confirm karna si ki tussi hale vi is baare dekh rahe ho?\`;
                        } else if (effectiveLang === 'hindi') {
                            openGreeting = \`Namaste \${nameGreeting}, main \${safeCompanyName} se baat kar rahi hoon. Aapne Facebook par hamare \${safeProduct} ke baare mein enquiry ki thi — kya aap abhi bhi iske baare mein explore kar rahe hain?\`;
                        } else if (effectiveLang === 'telugu') {
                            const safeTeName = safeName ? \`\${safeName} garu\` : 'andi';
                            openGreeting = \`Namaskaram \${safeTeName}, nenu \${safeCompanyName} nunchi call chesthunnanu. Meeru Facebook lo ma \${safeProduct} gurinchi enquiry chesaru — meeru inka deeni gurinchi chusthunnara ani telusukotaniki call chesanu.\`;
                        } else if (effectiveLang === 'tamil') {
                            const safeTaName = safeName ? \`\${safeName} avargale\` : '';
                            openGreeting = \`Vanakkam \${safeTaName}, naan \${safeCompanyName} lirundhu pesaren. Neenga Facebook la enga \${safeProduct} pathi enquiry pannirundheenga — adh pathi innum paathutu irukeengala nu therinjuka call pannen.\`;
                        } else if (effectiveLang === 'marathi') {
                            openGreeting = \`Namaskar \${nameGreeting}, mee \${safeCompanyName} madhun bolat ahe. Tumhi Facebook var aamchya \${safeProduct} baddal enquiry keli hoti — tumhi ajunhi ya baddal vichar karat ahat ka he janun ghenyasathi call kela ahe.\`;
                        } else if (effectiveLang === 'gujarati') {
                            const safeGuName = safeName ? \`\${safeName} bhai\` : '';
                            openGreeting = \`Namaste \${safeGuName}, hu \${safeCompanyName} mathi vat karu chu. Tame Facebook par amara \${safeProduct} mate enquiry kari hati — tame haji pan aa project ma interested chho e janva call karyo chhe.\`;
                        } else if (effectiveLang === 'bengali') {
                            const safeBnName = safeName ? \`\${safeName} babu\` : '';
                            openGreeting = \`Nomoshkar \${safeBnName}, aami \${safeCompanyName} theke bolchi. Aapni Facebook e aamader \${safeProduct} niye enquiry korechilen — aapni ki ekhono eta explore korchen kina jante call korlam.\`;
                        } else {
                            openGreeting = \`Haan ji \${nameGreeting}, main \${safeCompanyName} se baat kar rahi hoon. Aapne Facebook par hamare \${safeProduct} ke baare mein enquiry ki thi — bas check karna tha kya aap abhi bhi iske baare mein explore kar rahe hain?\`;
                        }
                    }\`;

// Replace greeting block handling CRLF and LF
const normContent = content.replace(/\r\n/g, '\n');
const normOldGreeting = oldGreetingLogic.replace(/\r\n/g, '\n');
if (normContent.includes(normOldGreeting)) {
    content = normContent.replace(normOldGreeting, newGreetingLogic);
    console.log('Successfully updated sendInitialGreeting with multi-language defaults.');
} else {
    console.warn('Could not match old greeting logic directly, attempting flexible regex...');
    const greetingBlockRegex = /const isIndianEn = campPromptLower\.includes[\s\S]*?openGreeting = `Haan ji \$\{nameGreeting\}[\s\S]*?\};\s*\}/;
    if (greetingBlockRegex.test(content)) {
        content = content.replace(greetingBlockRegex, newGreetingLogic.trim());
        console.log('Successfully replaced greeting block using regex.');
    }
}

fs.writeFileSync(serverJsPath, content, 'utf8');
console.log('Finished updating voice-bridge/server.js.');
