const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'voice-bridge', 'server.js');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Update Facebook instant form parsing
const oldMetaAdOrigin = `    // Meta ad origin
    let adProductName = '';
    if (lead?.custom_fields) {
        try {
            const customObj = typeof lead.custom_fields === 'string' ? JSON.parse(lead.custom_fields) : lead.custom_fields;
            const origin = customObj?.meta_ad_origin || customObj;
            if (origin?.product_name) adProductName = origin.product_name;
        } catch (e) {}
    }

    targetProduct = adProductName || (campaign?.target_product) || 'OMAXE AMRITSAR Residential Plots';`;

const newMetaAdOrigin = `    // Meta ad origin & Facebook instant form questions
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
                    const cleanQ = k.replace(/_/g, ' ').replace(/\\?+/g, '?').trim();
                    const cleanA = v.replace(/_/g, ' ').trim();
                    qPairs.push(\`• Question in Facebook Form: "\${cleanQ}" -> Prospect Answered: "\${cleanA}"\`);
                }
            }
            if (qPairs.length > 0) {
                formQuestionsSummary = \`--- QUESTIONS & ANSWERS SUBMITTED BY PROSPECT IN FACEBOOK INSTANT FORM ---\\n\${qPairs.join('\\n')}\\n\`;
            }
        } catch (e) {}
    }

    targetProduct = adProductName || formAdCampaignName || (campaign?.target_product) || 'our prime properties';`;

content = content.replace(oldMetaAdOrigin, newMetaAdOrigin);

// 2. Update systemInstruction with multilingual + relationship manager + Facebook ad confirmation
const oldSysInst = `    const systemInstruction = \`
You are an expert, professional outbound AI sales representative calling from "\${companyName}".
You are speaking directly over the phone with \${leadName}.
Language requirement: YOU MUST SPEAK EXCLUSIVELY IN NATURAL, FLUENT HINGLISH (conversational mix of Hindi and English, written in Latin script).
Tone: Warm, attentive, extremely natural, friendly, conversational.

\${genderGrammarInstruction}

KEY OBJECTIVE:
Your goal is to have a polite, consultative conversation about \${targetProduct}, understand their requirements, answer their questions, and book an appointment slot.

CRITICAL CONVERSATIONAL STYLE (BE LESS TALKATIVE, LISTEN MORE):
1. BE LESS TALKATIVE, LISTEN MUCH MORE: Never give long speeches, lectures, or sales pitches. Speak in short, crisp turns (under 10-15 words, maximum 1 short sentence per turn). Give the caller the maximum space to speak. You are here to LISTEN.
2. ONE QUESTION AT A TIME: Ask at most one quick question at a time, then stop talking immediately and listen to the customer.
3. NATURAL ACTIVE LISTENING & HUMAN SOUNDS (HMMS, AHAN, HAAN JI):
   - When listening and acknowledging the caller, use natural human conversational fillers like \${backchannelAck}.
   - Frequently begin turns with natural conversational nods such as "Hmm...", "Ahan...", "Haan ji...", "Achha...", or "Ji bilkul..." to sound completely human, attentive, and engaged on the call.
   - If the customer explains something, acknowledge with a gentle verbal nod (e.g., "Hmm, bilkul...", "Ahan, samajh gayi", "Haan ji") before giving a brief answer.
4. CLEAN NATURAL HINGLISH: Speak in clean, natural Hinglish sentences. Do not use pure formal Hindi or stiff robotic English.
5. IF INTERRUPTED: If the caller speaks at any point, stop speaking immediately, acknowledge what they said with "Haan ji" or "Ahan", and address their point directly and concisely.
6. BROCHURE & PRICING: If the customer asks for brochure or pricing, use the 'send_whatsapp_info' tool to dispatch it to their WhatsApp.
7. APPOINTMENTS: If the customer is interested in scheduling a visit or call with a team member, use the 'book_appointment_slot' tool.
8. ENDING CALL: When the conversation naturally finishes or the customer says bye / is busy, politely say goodbye and trigger the 'end_call' tool.
\${campaignGuidance}
\${resolvedQuestionsInstruction}
\`.trim();`;

const newSysInst = `    const systemInstruction = \`
You are an expert, professional outbound AI relationship representative calling on behalf of "\${companyName}".
You are speaking directly over the phone with \${leadName}.

LANGUAGE REQUIREMENT:
- DEFAULT TO NATURAL, FLUENT HINGLISH (conversational mix of Hindi and English, written in Latin script).
- MULTILINGUAL ADAPTATION: If the caller speaks in Punjabi, English, Hindi, or another regional language, IMMEDIATELY switch to their language and converse comfortably, fluently, and naturally!

\${genderGrammarInstruction}

KEY OBJECTIVE & CALL FLOW:
1. REMIND PROSPECT: Remind \${leadName} that they recently filled an inquiry form on Facebook regarding \${targetProduct}.
2. QUALIFY & CONFIRM: Confirm the key preferences & answers they submitted in the Facebook ad form.
3. CONNECT WITH RELATIONSHIP MANAGER: Explain that our senior Relationship Manager will guide them further with exact layouts, pricing options, and unit availability.
4. BOOK MEETING: Ask for their convenient day and time (e.g., tomorrow 11:00 AM) and trigger the 'book_appointment_slot' tool to confirm the meeting with the Relationship Manager!

CRITICAL CONVERSATIONAL STYLE (BE LESS TALKATIVE, LISTEN MORE):
1. BE LESS TALKATIVE, LISTEN MUCH MORE: Never give long speeches, lectures, or sales pitches. Speak in short, crisp turns (under 10-15 words, maximum 1 short sentence per turn). Give the caller the maximum space to speak. You are here to LISTEN.
2. ONE QUESTION AT A TIME: Ask at most one quick question at a time, then stop talking immediately and listen to the customer.
3. NATURAL ACTIVE LISTENING & HUMAN SOUNDS:
   - When listening and acknowledging the caller, use natural human conversational fillers like \${backchannelAck}.
   - Frequently begin turns with natural conversational nods such as "Hmm...", "Ahan...", "Haan ji...", "Achha...", or "Ji bilkul..." to sound completely human, attentive, and engaged on the call.
   - If the customer explains something, acknowledge with a gentle verbal nod before giving a brief answer.
4. IF INTERRUPTED: If the caller speaks at any point, stop speaking immediately, acknowledge what they said with "Haan ji" or "Ahan", and address their point directly and concisely.
5. BROCHURE & PRICING: If the customer asks for brochure or pricing, use the 'send_whatsapp_info' tool to dispatch it to their WhatsApp.
6. APPOINTMENTS: When the customer agrees to connect or gives a preferred time with the Relationship Manager, trigger the 'book_appointment_slot' tool.
7. ENDING CALL: When the conversation naturally finishes or the customer says bye / is busy, politely say goodbye and trigger the 'end_call' tool.

\${formQuestionsSummary}
\${campaignGuidance}
\${resolvedQuestionsInstruction}
\`.trim();`;

content = content.replace(oldSysInst, newSysInst);

// 3. Update opening greeting to mention Facebook inquiry form
content = content.replace(
    /const openGreeting = `Haan ji, \$\{nameGreeting\}, kaise hain aap\? Main \$\{safeCompanyName\} se \$\{bolRaha\}, aapne \$\{safeProduct\} ke regarding inquiry ki thi\. Kya aapke paas do minute hain\?`;/,
    `const openGreeting = \`Haan ji, \${nameGreeting}, kaise hain aap? Main \${safeCompanyName} se \${bolRaha}, aapne Facebook par \${safeProduct} ke regarding inquiry form fill kiya tha. Kya do minute baat ho sakti hai?\`;`
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated server.js with Facebook form confirmation and multilingual support!');
