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
    let geminiApiKey = null; // Resolved dynamically from tenant profile or env
    
    let leadId = null;
    let profileId = null;
    let profileData = null;
    let leadPhone = null;
    let leadName = 'there';

    const transcriptTurns = [];

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

                console.log(`[BRIDGE] Twilio call started. StreamSid: ${twilioStreamSid}, CallSid: ${twilioCallSid}, leadId: ${leadId}, profileId: ${profileId}`);

                if (!leadId || !profileId) {
                    console.error('[BRIDGE] Missing customParameters: leadId or profileId in start packet.');
                    wsConnection.close(4001, 'Missing customParameters.');
                    return;
                }

                // 1. Fetch details from Supabase and connect to Gemini in parallel
                let systemInstruction = 'You are a helpful representative. Focus on booking an appointment.';
                let greetingMessage = 'Hello, how are you?';

                const dbPromise = Promise.all([
                    supabaseAdmin.from('profiles').select('*').eq('id', profileId).maybeSingle(),
                    supabaseAdmin.from('leads').select('*').eq('id', leadId).maybeSingle(),
                    supabaseAdmin.from('properties').select('*').eq('user_id', profileId).limit(5)
                ]);

                const defaultApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
                console.log('[BRIDGE] Connecting to Gemini Live WebSocket concurrently...');
                let tempSocket = new ws(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${defaultApiKey || ''}`);

                let profile = null;
                let lead = null;
                let props = null;

                try {
                    const [profileRes, leadRes, propsRes] = await dbPromise;
                    profile = profileRes.data;
                    profileData = profile;
                    lead = leadRes.data;
                    props = propsRes.data;

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
                                productContext = `Primary Interest Property: ${prop.title || 'N/A'}\nDetails: ${prop.description || 'N/A'}\nPrice: ${prop.price || 'N/A'}`;
                            }
                        }

                        // Build Catalog Context
                        let catalogContext = '';
                        if (props && props.length > 0) {
                            catalogContext = props.map((p, i) => `${i + 1}. ${p.title} (${p.property_type || 'General'}): Price ${p.price || 'Contact us'}, Details: ${p.description || ''}`).join('\n');
                        }

                        const companyName = profile?.business_name || 'our company';
                        const firstName = leadName.split(' ')[0] || 'there';
                        
                        systemInstruction = `
You are a helpful AI Voice calling assistant for "${companyName}".
Your name is a booking representative.
Your primary objective is to make the lead, ${leadName}, book an appointment/consultation with the business.

CONVERSATION FLOW:
1. Your first greeting is: "Hi ${firstName} ji, kaise ho aap?". (This is already spoken initially).
2. Once the lead responds to your greeting, your immediate next response must be to ask if they have availability to talk right now (e.g., "Kya aapke paas abhi baat karne ke liye time hai?").
3. After they confirm availability or agree to speak, proceed with the rest of the conversation (introduce yourself as the AI booking assistant from ${companyName}, and guide them to schedule a consultation/appointment).

CRITICAL RULES:
1. ONLY speak about the provided business profile info, catalog, and the lead's details.
2. DO NOT make up, assume, or hallucinate details. If you don't know an answer, say: "That is a great question. I don't have that detail on hand, but let's book a quick consultation call so our representative can answer that for you."
3. Be polite, friendly, and brief in your responses. Keep responses under 45 words.
4. Your single goal is to find a suitable date and time slot for a meeting.
5. LANGUAGE STYLE: Speak in a natural, friendly mix of Hindi and English (Hinglish) when responding to the user.
6. ENDING THE CALL: Once the call objective is met or the lead wants to end, say a brief polite goodbye and trigger your "end_call" tool to hang up the call immediately.
7. GENDER & PRONOUNS: You are a female assistant. You must always use female grammar and pronouns when speaking Hindi/Hinglish (e.g., use "karti hoon" instead of "karta hoon", "karungi" instead of "karunga", "baat kar rahi hoon" instead of "baat kar raha hoon", "de sakti hoon" instead of "de sakta hoon", "bhejti hoon" instead of "bhejta hoon").

--- BUSINESS CONTEXT ---
Business Name: ${companyName}
Business Info: ${profile?.business_info || 'N/A'}
Lead Name: ${leadName}
Lead Phone: ${leadPhone || 'N/A'}
Notes/History: ${lead.notes || 'None'}
${productContext ? `--- LEAD INTEREST ---\n${productContext}\n` : ''}
${catalogContext ? `--- PROPERTIES CATALOG ---\n${catalogContext}\n` : ''}
`.trim();

                        greetingMessage = `Hi ${firstName} ji, kaise ho aap?`;
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
                                        voiceName: "Aoede" // Warm female voice config
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
                         console.log('[BRIDGE] Received from Gemini:', JSON.stringify(serverMsg));
                         
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
                            const initialTurn = {
                                clientContent: {
                                    turns: [
                                        {
                                            role: "user",
                                            parts: [{ text: `Hello! Call has connected. Please speak this exact greeting message now in a warm, welcoming tone: "${greetingMessage}"` }]
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

                                    // Trigger Twilio REST Call Termination
                                    if (twilioCallSid && profileData) {
                                        const twilioSid = process.env.MASTER_TWILIO_SID || profileData.voice_twilio_sid;
                                        const twilioToken = process.env.MASTER_TWILIO_TOKEN || profileData.voice_twilio_token;
                                        
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
                // Compile raw text transcript
                const fullTranscript = transcriptTurns
                    .map(t => `${t.role === 'user' ? (leadName || 'User') : 'Assistant'}: ${t.message}`)
                    .join('\n');
                
                console.log('[BRIDGE] Conversation Transcript Compiled:\n', fullTranscript);

                // Use Gemini Flash API (REST) to generate summary of this call
                let summary = 'Conversation took place via Gemini Voice AI.';
                try {
                    const summaryPrompt = `
Generate a quick, concise one-sentence summary of the following phone conversation between our sales assistant and the lead:
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
                try {
                    await supabaseAdmin
                        .from('leads')
                        .update({
                            voice_call_status: 'completed',
                            voice_call_summary: summary,
                            voice_call_transcript: transcriptTurns,
                            voice_call_retry_count: 0
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
                    transcript: fullTranscript
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
