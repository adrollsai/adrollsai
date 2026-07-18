const path = require('path');
const express = require('express');
const ws = require('ws');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables (look in root directory for local dev)
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
require('dotenv').config(); // Fallback for container system variables

const PORT = process.env.PORT || 5050;

// Initialize Supabase Admin Client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[BRIDGE SERVER] Missing Supabase credentials in environment.');
    process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
    realtime: {
        transport: ws
    }
});

// Express Server setup
const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'gemini-voice-bridge' });
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

// WSS Handlers
wss.on('connection', (wsConnection) => {
    console.log('[BRIDGE] New WebSocket connection request from Twilio.');

    let twilioStreamSid = null;
    let twilioCallSid = null;
    let geminiSocket = null;
    let geminiReady = false;
    let geminiApiKey = null;
    
    let leadId = null;
    let profileId = null;
    let profileData = null;
    let leadPhone = null;
    let leadName = 'there';

    const transcriptTurns = [];
    let greetingPlayed = false;
    let voiceName = 'Aoede';

    // Connection health check (heartbeat to prevent lingering ghost connections)
    let isAlive = true;
    wsConnection.on('pong', () => { isAlive = true; });

    const pingInterval = setInterval(() => {
        if (!isAlive) {
            console.log('[BRIDGE] Twilio WS connection timed out. Closing...');
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

    // Helper to process and forward media packets
    function sendMediaToGemini(payload) {
        try {
            const muLawBytes = Buffer.from(payload, 'base64');
            const pcm8 = new Int16Array(muLawBytes.length);
            for (let i = 0; i < muLawBytes.length; i++) {
                pcm8[i] = decodeMuLaw(muLawBytes[i]);
            }

            // Upsample to 16kHz
            const pcm16 = upsample8To16(pcm8);

            // Convert back to binary buffer
            const outBuffer = Buffer.alloc(pcm16.length * 2);
            for (let i = 0; i < pcm16.length; i++) {
                outBuffer.writeInt16LE(pcm16[i], i * 2);
            }

            // Send PCM 16-bit to Gemini Live
            if (geminiSocket && geminiSocket.readyState === ws.OPEN) {
                geminiSocket.send(JSON.stringify({
                    realtimeInput: {
                        audio: {
                            mimeType: "audio/pcm;rate=16000",
                            data: outBuffer.toString('base64')
                        }
                    }
                }));
            }
        } catch (err) {
            console.error('[BRIDGE] Error sending media to Gemini:', err);
        }
    }

    // Handle incoming Twilio messages
    wsConnection.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString());

            if (data.event === 'start') {
                twilioStreamSid = data.start.streamSid;
                twilioCallSid = data.start.callSid;
                leadId = data.start.customParameters?.leadId;
                profileId = data.start.customParameters?.profileId;
                const campaignId = data.start.customParameters?.campaignId;
                greetingPlayed = data.start.customParameters?.greetingPlayed === 'true';
                voiceName = data.start.customParameters?.voiceName || 'Aoede';

                console.log(`[BRIDGE] Twilio call started. StreamSid: ${twilioStreamSid}, CallSid: ${twilioCallSid}, leadId: ${leadId}, profileId: ${profileId}, campaignId: ${campaignId}, greetingPlayed: ${greetingPlayed}, voiceName: ${voiceName}`);

                if (!leadId || !profileId) {
                    console.error('[BRIDGE] Missing customParameters: leadId or profileId in start packet.');
                    wsConnection.close(4001, 'Missing customParameters.');
                    return;
                }

                // 1. Fetch details from Supabase and connect to Gemini in parallel
                let systemInstruction = 'You are a helpful representative. Focus on booking an appointment.';
                let greetingMessage = 'Hello, how are you?';

                // Clear old voice call fields immediately to prevent status callback race conditions
                try {
                    await supabaseAdmin
                        .from('leads')
                        .update({
                            voice_call_summary: null,
                            voice_call_transcript: null,
                            voice_recording_url: null,
                            voice_call_status: 'calling'
                        })
                        .eq('id', leadId);
                    console.log(`[BRIDGE] Cleared stale voice call fields for lead ${leadId}`);
                } catch (dbClearErr) {
                    console.error('[BRIDGE] Failed to clear stale voice call fields:', dbClearErr);
                }

                const campaignPromise = campaignId
                    ? supabaseAdmin.from('voice_campaigns').select('*').eq('id', campaignId).maybeSingle()
                    : Promise.resolve({ data: null });

                const dbPromise = Promise.all([
                    supabaseAdmin.from('profiles').select('*').eq('id', profileId).maybeSingle(),
                    supabaseAdmin.from('leads').select('*').eq('id', leadId).maybeSingle(),
                    supabaseAdmin.from('properties').select('*').eq('user_id', profileId).limit(5),
                    campaignPromise,
                    supabaseAdmin.from('flagged_questions').select('*').eq('lead_id', leadId).eq('resolved', true).not('answer', 'is', null)
                ]);

                const defaultApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
                console.log('[BRIDGE] Connecting to Gemini Live WebSocket concurrently...');
                let tempSocket = new ws(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${defaultApiKey || ''}`);

                let profile = null;
                let lead = null;
                let props = null;
                let campaign = null;
                let resolvedQuestions = [];

                try {
                    const [profileRes, leadRes, propsRes, campaignRes, flaggedRes] = await dbPromise;
                    profile = profileRes.data;
                    profileData = profile;
                    lead = leadRes.data;
                    props = propsRes.data;
                    campaign = campaignRes ? campaignRes.data : null;
                    resolvedQuestions = flaggedRes?.data || [];

                    if (lead) {
                        leadPhone = lead.phone;
                        leadName = lead.name || 'there';
                        
                        // Build Product Context
                        let productContext = '';
                        if (lead.property_id) {
                            const { data: prop } = await supabaseAdmin
                                .from('properties')
                                .select('*')
                                .eq('id', lead.property_id)
                                .maybeSingle();
                            if (prop) {
                                productContext = `<interested_property>
  <title>${prop.title || 'N/A'}</title>
  <type>${prop.property_type || 'N/A'}</type>
  <price>${prop.price || 'N/A'}</price>
  <description>${prop.description || 'N/A'}</description>
</interested_property>`;
                            }
                        }

                        // Build Catalog Context
                        let catalogContext = '';
                        if (props && props.length > 0) {
                            catalogContext = props.map((p) => {
                                return `<property>
  <title>${p.title || 'N/A'}</title>
  <type>${p.property_type || 'N/A'}</type>
  <price>${p.price || 'N/A'}</price>
  <description>${p.description || 'N/A'}</description>
</property>`;
                            }).join('\n');
                        }

                        // Fetch WhatsApp history for conversational context
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
                        } catch (waErr) {
                            console.error('[BRIDGE] WhatsApp history fetch error:', waErr);
                        }

                        // Fetch previous call summaries from lead_history
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
                                        } catch (e) { /* skip malformed */ }
                                    }
                                }
                                if (parsedCalls.length > 0) previousCallsHistory = parsedCalls.join('\n');
                            }
                        } catch (chErr) {
                            console.error('[BRIDGE] Call history fetch error:', chErr);
                        }
                        if (!previousCallsHistory && lead.voice_call_summary) {
                            previousCallsHistory = `- Last Call Summary: ${lead.voice_call_summary}`;
                        }

                        const companyName = profile?.business_name || 'our company';
                        const firstName = leadName.split(' ')[0] || 'there';
                        const isFirstCall = !previousCallsHistory && !whatsappHistory;

                        // Build proactive context instruction for the agent's second turn (after greeting response)
                        let sourceInstructions = "";
                        let contextInstruction = "";
                        if (isFirstCall) {
                            sourceInstructions = `\nThis is your FIRST call to this lead.`;
                            if (lead.source) {
                                const cleanSource = lead.source.toLowerCase();
                                if (cleanSource.includes('facebook') || cleanSource.includes('fb') || cleanSource.includes('instagram') || cleanSource.includes('ad')) {
                                    contextInstruction = `   After the lead responds to your greeting, proactively establish context. Say something like: "Aapne hamaari ad dekhi hogi ${companyName} ki, ussi ke regarding call kar rahi hoon." Then naturally ask about their availability.`;
                                } else {
                                    contextInstruction = `   After the lead responds to your greeting, proactively establish context. Say something like: "Aapne ${lead.source} par interest dikhaya tha, ussi ke regarding ${companyName} se call kar rahi hoon." Then naturally ask about their availability.`;
                                }
                            } else {
                                contextInstruction = `   After the lead responds to your greeting, introduce yourself and what the business does. ${productContext ? 'Mention the product/property they may be interested in from the LEAD INTEREST section below.' : (profile?.business_info ? `Briefly mention what the business deals in based on this info: "${profile.business_info.substring(0, 150).replace(/"/g, "'")}"` : '')} Say something like: "Main ${companyName} se baat kar rahi hoon, hum [mention product/service] mein deal karte hain." Then naturally ask about their availability.`;
                            }
                        } else {
                            sourceInstructions = `\nThis is a FOLLOW-UP call. The lead has been contacted before.`;
                            if (previousCallsHistory) {
                                contextInstruction = `   After the lead responds to your greeting, reference the previous conversation to establish recognition. Say something like: "Humne pichli baar baat ki thi..." and briefly mention what was discussed based on the Previous Call History provided below. Keep it natural and brief so the prospect remembers. Then ask about their availability.`;
                            } else if (whatsappHistory) {
                                contextInstruction = `   After the lead responds to your greeting, reference the WhatsApp conversation to establish recognition. Say something like: "Aapki WhatsApp par humse baat hui thi, ussi ke regarding follow-up call kar rahi hoon." Briefly reference what was discussed. Then ask about their availability.`;
                            } else {
                                contextInstruction = `   After the lead responds to your greeting, say: "Humne pichli baar baat ki thi ${companyName} ke regarding, ussi ke follow-up mein call kar rahi hoon." Then naturally ask about their availability.`;
                            }
                        }

                        let resolvedQuestionsInstruction = "";
                        if (resolvedQuestions && resolvedQuestions.length > 0) {
                            resolvedQuestionsInstruction = `\n\n--- RECENTLY RESOLVED QUESTIONS ---
The prospect recently asked the following questions which we have now resolved. Please proactively bring them up and clear their doubts:
`;
                            resolvedQuestions.forEach((q, idx) => {
                                resolvedQuestionsInstruction += `\nQuestion ${idx+1}: "${q.question}"\nAnswer: "${q.answer}"\n`;
                            });
                            resolvedQuestionsInstruction += `\nGreet the user and clear their doubts regarding these questions first.`;
                        }


                        
                        if (campaign && campaign.custom_prompt) {
                            systemInstruction = `
${campaign.custom_prompt}

${sourceInstructions}
${contextInstruction}
${resolvedQuestionsInstruction}

--- LEAD & BUSINESS CONTEXT ---
Lead Name: ${leadName}
Lead Phone: ${leadPhone || 'N/A'}
Notes/History: ${lead.notes || 'None'}
${productContext ? `--- LEAD INTEREST ---\n${productContext}\n` : ''}
${catalogContext ? `--- PROPERTIES CATALOG ---\n${catalogContext}\n` : ''}
${previousCallsHistory ? `--- PREVIOUS CALL HISTORY ---\n${previousCallsHistory}\n` : ''}
${whatsappHistory ? `--- PREVIOUS WHATSAPP HISTORY ---\n${whatsappHistory}\n` : ''}
`.trim();

                            const promptLower = campaign.custom_prompt.toLowerCase();
                            const isHinglish = promptLower.includes('hinglish') || promptLower.includes('hindi') || promptLower.includes('india');
                            if (resolvedQuestions.length > 0) {
                                greetingMessage = `Hi ${firstName} ji! Main assistant baat kar rahi hoon. Aapne pichli call mein jo sawal pucha tha, uska answer humare paas aa gaya hai. Main aapke doubts clear karne ke liye call kar rahi hoon. Kaise hain aap?`;
                            } else if (isHinglish) {
                                greetingMessage = `Hi ${firstName} ji! Main assistant baat kar raha hoon aapki query ke regarding. Kaise hain aap?`;
                            } else {
                                greetingMessage = `Hi ${firstName}! I'm calling to follow up on your recent request. How are you doing today?`;
                            }
                        } else {
                            systemInstruction = `
You are a helpful AI Voice calling assistant for "${companyName}".
Your name is a booking representative.
Your primary objective is to make the lead, ${leadName}, book an appointment/consultation with the business.

CONVERSATION FLOW:
1. Your first greeting is: "Hi ${firstName} ji, kaise ho aap?". (This is already spoken initially).
2. Once the lead responds to your greeting, your NEXT response must proactively establish context and recognition:
${contextInstruction}
3. After establishing context, proceed with the conversation (guide them to schedule a consultation/appointment with ${companyName}).

CRITICAL RULES (CLOSED-WORLD GROUNDING):
1. STRICT CLOSED-WORLD ASSUMPTION: You must ONLY speak about the facts explicitly provided in the business profile info, catalog, and lead details.
2. NO HALLUCINATIONS: Do NOT assume, extrapolate, guess, or invent any information (such as builder/developer names, completion dates, materials used, amenities, or specific project features) if they are not explicitly written in the description or details for that specific property.
3. PROPERTY INDEPENDENCE: Keep property information completely separate. Do NOT mix details (like price, location, or builder) from one property (e.g., Homeland) and apply them to another property (e.g., Ananta).
4. UNANSWERABLE QUESTIONS: If a user asks a question about a property, project, or business that is not explicitly answered in the context provided below, you MUST reply: "That is a great question. I don't have that specific detail on hand, but let's book a quick consultation call so our representative can get that exact info for you."
5. Be polite, friendly, and brief in your responses. Keep responses under 45 words.
6. Your single goal is to find a suitable date and time slot for a meeting.
7. LANGUAGE STYLE: Speak in a natural, friendly mix of Hindi and English (Hinglish) when responding to the user.
8. ENDING THE CALL: Once the call objective is met or the lead wants to end, say a brief polite goodbye and trigger your "end_call" tool to hang up the call immediately.
9. GENDER & PRONOUNS: You are a female assistant. You must always use female grammar and pronouns when speaking Hindi/Hinglish (e.g., use "karti hoon" instead of "karta hoon", "karungi" instead of "karunga", "baat kar rahi hoon" instead of "baat kar raha hoon", "de sakti hoon" instead of "de sakta hoon", "bhejti hoon" instead of "bhejta hoon").
10. VOICEMAIL / ANSWERING MACHINE DETECTION: If you hear a voicemail greeting, answering machine message, or any automated message (such as "please leave a message", "after the beep", or an automated robot voice), you must immediately trigger your "end_call" tool to hang up the call. Do NOT speak, say hello, or say goodbye; just trigger "end_call" instantly.

${sourceInstructions}
${resolvedQuestionsInstruction}

--- BUSINESS CONTEXT ---
Business Name: ${companyName}
Business Info: ${profile?.business_info || 'N/A'}
Lead Name: ${leadName}
Lead Phone: ${leadPhone || 'N/A'}
Notes/History: ${lead.notes || 'None'}
${productContext ? `--- LEAD INTEREST ---\n${productContext}\n` : ''}
${catalogContext ? `--- PROPERTIES CATALOG ---\n${catalogContext}\n` : ''}
${previousCallsHistory ? `--- PREVIOUS CALL HISTORY ---\n${previousCallsHistory}\n` : ''}
${whatsappHistory ? `--- PREVIOUS WHATSAPP HISTORY ---\n${whatsappHistory}\n` : ''}
`.trim();

                            if (resolvedQuestions.length > 0) {
                                greetingMessage = `Hi ${firstName} ji! Main assistant baat kar rahi hoon. Aapne pichli call mein jo sawal pucha tha, uska answer humare paas aa gaya hai. Main aapke doubts clear karne ke liye call kar rahi hoon. Kaise hain aap?`;
                            } else {
                                greetingMessage = `Hi ${firstName} ji, kaise ho aap?`;
                            }
                        }
                    }
                } catch (dbErr) {
                    console.error('[BRIDGE] DB context fetch error:', dbErr);
                }

                // Check if custom key needs reconnection
                const customApiKey = profile?.gemini_api_key;
                if (customApiKey && customApiKey !== defaultApiKey) {
                    console.log('[BRIDGE] Custom API Key found in profile. Reconnecting with tenant key...');
                    tempSocket.close();
                    tempSocket = new ws(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${customApiKey}`);
                }
                geminiSocket = tempSocket;
                geminiApiKey = customApiKey || defaultApiKey;

                // Wait for socket to open if it hasn't already
                if (geminiSocket.readyState !== ws.OPEN) {
                    await new Promise((resolve) => {
                        geminiSocket.once('open', resolve);
                    });
                }

                console.log('[BRIDGE] Gemini Socket opened. Sending setup config...');
                
                const setupPayload = {
                    setup: {
                        model: "models/gemini-3.1-flash-live-preview",
                        generationConfig: {
                            responseModalities: ["AUDIO"],
                            speechConfig: {
                                voiceConfig: {
                                    prebuiltVoiceConfig: {
                                        voiceName: voiceName
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
                                    }
                                ]
                            }
                        ],
                        inputAudioTranscription: {},
                        outputAudioTranscription: {}
                    }
                };
                geminiSocket.send(JSON.stringify(setupPayload));

                 geminiSocket.on('message', async (data) => {
                     try {
                         const serverMsg = JSON.parse(data.toString());
                          // Only log if it's not a standard streaming media packet
                          if (!serverMsg.serverContent?.modelTurn?.parts?.some(p => p.inlineData) && !serverMsg.serverContent?.outputTranscription) {
                              console.log('[BRIDGE] Received from Gemini:', JSON.stringify(serverMsg));
                          }
                         
                         // Handle user interruption (barge-in)
                         if (serverMsg.serverContent?.interrupted) {
                             console.log('[BRIDGE] Gemini detected user interruption. Clearing Twilio audio buffer...');
                             if (wsConnection.readyState === ws.OPEN && twilioStreamSid) {
                                 wsConnection.send(JSON.stringify({
                                     event: 'clear',
                                     streamSid: twilioStreamSid
                                 }));
                             }
                         }
                         
                         // Handle setup complete before sending greeting
                          if (serverMsg.setupComplete) {
                             console.log('[BRIDGE] Gemini Setup Complete received. Injecting greeting turn...');
                             
                             const textPrompt = greetingPlayed
                                 ? `The call has connected. We have already played the initial welcome greeting to the user: "${greetingMessage}". Do NOT repeat this greeting. Please wait silently for the user to respond first, and then reply naturally in Hinglish.`
                                 : `Hello! Call has connected. Please speak this exact greeting message now in a warm, welcoming tone: "${greetingMessage}"`;

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
                             console.log('[BRIDGE] Sending to Gemini:', JSON.stringify(initialTurn));
                             geminiSocket.send(JSON.stringify(initialTurn));
                             geminiReady = true;
                            console.log('[BRIDGE] geminiReady set to true. Waiting for Gemini audio response...');
                            return;
                        }

                        // 1. Handle audio chunks from Gemini output (24kHz PCM)
                        if (serverMsg.serverContent?.modelTurn?.parts) {
                            for (const part of serverMsg.serverContent.modelTurn.parts) {
                                // Record agent text transcription
                                if (part.text) {
                                    console.log(`[Gemini Agent]: ${part.text}`);
                                    transcriptTurns.push({ role: 'agent', message: part.text });
                                }
                                
                                if (part.inlineData && part.inlineData.data) {
                                    const base64PCM = part.inlineData.data;
                                    const pcm24Bytes = Buffer.from(base64PCM, 'base64');
                                    const pcm24 = new Int16Array(pcm24Bytes.length / 2);
                                    for (let i = 0; i < pcm24.length; i++) {
                                        pcm24[i] = pcm24Bytes.readInt16LE(i * 2);
                                    }

                                    // Downsample to 8kHz
                                    const pcm8 = downsample24To8(pcm24);

                                    // Encode to mu-law
                                    const muLawBytes = Buffer.alloc(pcm8.length);
                                    for (let i = 0; i < pcm8.length; i++) {
                                        muLawBytes[i] = encodeMuLaw(pcm8[i]);
                                    }
                                    const base64MuLaw = muLawBytes.toString('base64');

                                    // Forward to Twilio
                                    if (wsConnection.readyState === ws.OPEN && twilioStreamSid) {
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
                                    console.log('[BRIDGE] Gemini triggered tool: end_call. Hanging up Twilio...');
                                    
                                    // Send empty response back to Gemini
                                    geminiSocket.send(JSON.stringify({
                                        toolResponse: {
                                            functionResponses: [{
                                                name: "end_call",
                                                id: call.id,
                                                response: { success: true }
                                            }]
                                        }
                                    }));

                                    // Trigger Twilio REST Call Termination & Close WebSocket with a 3-second delay
                                    // to allow in-flight audio (like goodbye dialogue) to finish playing to the lead.
                                    console.log('[BRIDGE] Waiting 3 seconds for audio playout before hanging up...');
                                    setTimeout(async () => {
                                        if (twilioCallSid && profileData) {
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

                                        // Close WebSocket connection
                                        wsConnection.close();
                                    }, 3000);
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

                geminiSocket.on('close', (code, reason) => {
                    console.log(`[BRIDGE] Gemini Socket closed. Code: ${code}, Reason: ${reason ? reason.toString() : ''}`);
                    if (wsConnection.readyState === ws.OPEN) {
                        wsConnection.close();
                    }
                });
            }

            if (data.event === 'media') {
                const payload = data.media.payload;
                if (geminiReady && geminiSocket && geminiSocket.readyState === ws.OPEN) {
                    sendMediaToGemini(payload);
                }
            }

            if (data.event === 'stop') {
                console.log('[BRIDGE] Twilio call stopped.');
                wsConnection.close();
            }
        } catch (err) {
            console.error('[BRIDGE] Error processing Twilio stream packet:', err);
        }
    });

     wsConnection.on('close', async (code, reason) => {
        clearInterval(pingInterval);
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

                // Use Gemini Flash API (REST) to generate summary of this call
                let summary = 'Conversation took place via Gemini Voice AI.';
                try {
                    const summaryPrompt = `
You are analyzing a phone call transcript. Write a concise, professional 2-3 sentence summary of the call.
Do NOT use markdown headers, bold, bullets, or lists. Output only a single clean paragraph.

Transcript:
${fullTranscript}
`.trim();
                    const restUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${geminiApiKey}`;
                    const summaryRes = await fetch(restUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: summaryPrompt }] }]
                        })
                    });
                    const summaryData = await summaryRes.json();
                    const text = summaryData.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (text) {
                        summary = text.trim();
                    }
                } catch (sumErr) {
                    console.error('[BRIDGE] Auto-summarization failed:', sumErr);
                }

                // Update leads table with summary, transcript, and completed status
                // Note: voice_call_retry_count is intentionally NOT reset here.
                // The Twilio status-callback handles retry count logic correctly,
                // and resetting it here would cause a race condition.
                try {
                    await supabaseAdmin
                        .from('leads')
                        .update({
                            voice_call_status: 'completed',
                            voice_call_summary: summary,
                            voice_call_transcript: mergedTurns
                        })
                        .eq('id', leadId);
                    console.log('[BRIDGE] Leads table summary and transcript updated successfully!');
                } catch (leadErr) {
                    console.error('[BRIDGE] Failed to save transcript/summary to lead:', leadErr);
                }

                // Insert into Supabase lead_history
                const historyData = {
                    summary,
                    recording_url: null, // Will be filled dynamically by status callback
                    transcript: mergedTurns
                };

                const { error: histErr } = await supabaseAdmin
                    .from('lead_history')
                    .insert({
                        lead_id: leadId,
                        action_type: 'REMARK',
                        description: `🎙️ CALL_JSON:${JSON.stringify(historyData)}`
                    });

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
