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

// Express Server setup
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const prewarmedPool = new Map();

app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'gemini-voice-bridge' });
});

// Vobiz Answer XML endpoint (Returns Stream XML directly to Vobiz)
app.all(['/vobiz-xml', '/api/voice/vobiz/xml'], (req, res) => {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    const wsProtocol = protocol === 'https' ? 'wss' : 'ws';
    const leadId = req.query.leadId || req.body?.leadId || '';
    const profileId = req.query.profileId || req.body?.profileId || '';
    const campaignId = req.query.campaignId || req.body?.campaignId || '';

    const wsUrl = `${wsProtocol}://${host}/gemini-live-stream?leadId=${leadId}&profileId=${profileId}&campaignId=${campaignId}&telephony=vobiz`;
    const escapedWsUrl = wsUrl.replace(/&/g, '&amp;');
    const statusUrl = `${protocol}://${host}/vobiz-status?leadId=${leadId}`;

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-l16;rate=16000" statusCallbackUrl="${statusUrl}">${escapedWsUrl}</Stream>
</Response>`;

    console.log(`[BRIDGE VOBIZ-XML] Served Voice XML to Vobiz for lead ${leadId}:\n${xml}`);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.send(xml);
});

// Vobiz Status Callback endpoint
app.all(['/vobiz-status', '/api/voice/vobiz/status-callback'], async (req, res) => {
    const leadId = req.query.leadId || req.body?.leadId;
    const callStatus = (req.body?.CallStatus || req.body?.call_status || req.body?.Status || req.body?.event || '').toLowerCase();
    const duration = req.body?.Duration || req.body?.duration || 0;
    const callUuid = req.body?.CallUUID || req.body?.call_uuid || '';

    console.log(`[BRIDGE VOBIZ-STATUS] Received status for lead ${leadId}: status=${callStatus}, duration=${duration}s, callUuid=${callUuid}`);

    if (leadId) {
        let updatedStatus = null;
        if (['in-progress', 'answered'].includes(callStatus)) {
            updatedStatus = 'calling';
        } else if (['completed', 'hangup', 'stopped'].includes(callStatus)) {
            updatedStatus = 'completed';
        } else if (['busy', 'no-answer', 'timeout', 'rejected'].includes(callStatus)) {
            updatedStatus = 'no_answer';
        } else if (['failed', 'cancelled'].includes(callStatus)) {
            updatedStatus = 'failed';
        }

        if (updatedStatus) {
            try {
                const updatePayload = { voice_call_status: updatedStatus };
                if (duration > 0) updatePayload.voice_call_duration = parseInt(duration, 10);
                await supabaseAdmin.from('leads').update(updatePayload).eq('id', leadId);
            } catch (err) {
                console.warn('[BRIDGE VOBIZ-STATUS] DB update error:', err);
            }
        }
    }

    res.json({ success: true });
});

app.post('/prewarm', async (req, res) => {
    try {
        const { leadId, profileId, campaignId } = req.body;
        if (!leadId || !profileId) {
            return res.status(400).json({ error: 'Missing leadId or profileId in prewarm request.' });
        }
        console.log(`[PREWARM] Pre-warming session for lead: ${leadId}, profile: ${profileId}`);

        if (prewarmedPool.has(leadId)) {
            return res.json({ status: 'already_prewarmed', leadId });
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
        const tempSocket = new ws(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${defaultApiKey || ''}`);

        const prewarmedEntry = {
            leadId,
            profileId,
            campaignId,
            dbPromise,
            tempSocket,
            used: false,
            createdAt: Date.now()
        };

        prewarmedPool.set(leadId, prewarmedEntry);

        setTimeout(() => {
            const entry = prewarmedPool.get(leadId);
            if (entry && entry.createdAt === prewarmedEntry.createdAt && !entry.used) {
                console.log(`[PREWARM] Cleaning up expired unused prewarmed session for lead ${leadId}`);
                if (entry.tempSocket && entry.tempSocket.readyState === ws.OPEN) {
                    entry.tempSocket.close();
                }
                prewarmedPool.delete(leadId);
            }
        }, 45000);

        res.json({ status: 'prewarmed', leadId });
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

// Phone Ringback Tone Synthesizer (400Hz + 450Hz dual tone, 8kHz mu-law)
function generateRingbackToneBuffer(durationSec = 6.0) {
    const sampleRate = 8000;
    const totalSamples = Math.floor(sampleRate * durationSec);
    const muLawBuffer = Buffer.alloc(totalSamples);
    const f1 = 400;
    const f2 = 450;
    const gain = 0.22; // Comfortable soft ringing volume

    for (let i = 0; i < totalSamples; i++) {
        const timeSec = i / sampleRate;
        const cycleTime = timeSec % 3.2; // 1.2s tone, 2.0s pause ring cycle

        let pcmSample = 0;
        if (cycleTime < 1.2) {
            const s1 = Math.sin(2 * Math.PI * f1 * timeSec);
            const s2 = Math.sin(2 * Math.PI * f2 * timeSec);
            let env = 1.0;
            if (cycleTime < 0.05) env = cycleTime / 0.05;
            else if (cycleTime > 1.15) env = (1.2 - cycleTime) / 0.05;

            pcmSample = Math.round((s1 + s2) * 0.5 * gain * env * 32767);
        }
        muLawBuffer[i] = encodeMuLaw(pcmSample);
    }
    return muLawBuffer;
}

const GLOBAL_RINGBACK_BUFFER = generateRingbackToneBuffer(6.0);

// Realistic Vocal Backchannel Synthesizers ("ahaan", "hmm", "haan ji")
function generateAhaanBackchannelBuffer() {
    const sampleRate = 8000;
    const durationSec = 0.42; // 420ms "ahaan..."
    const totalSamples = Math.floor(sampleRate * durationSec);
    const muLawBuffer = Buffer.alloc(totalSamples);
    const gain = 0.28; // Comfortable vocal volume

    for (let i = 0; i < totalSamples; i++) {
        const t = i / sampleRate;
        const freq = t < 0.2 ? (220 + (40 * (t / 0.2))) : (260 - (50 * ((t - 0.2) / 0.22)));
        const env = Math.sin(Math.PI * (t / durationSec));
        const s1 = Math.sin(2 * Math.PI * freq * t);
        const s2 = 0.35 * Math.sin(2 * Math.PI * (freq * 2) * t);
        const pcmSample = Math.round((s1 + s2) * 0.5 * gain * env * 32767);
        muLawBuffer[i] = encodeMuLaw(pcmSample);
    }
    return muLawBuffer;
}

function generateHmmBackchannelBuffer() {
    const sampleRate = 8000;
    const durationSec = 0.35;
    const totalSamples = Math.floor(sampleRate * durationSec);
    const muLawBuffer = Buffer.alloc(totalSamples);
    const gain = 0.28;

    for (let i = 0; i < totalSamples; i++) {
        const t = i / sampleRate;
        const freq = 210 - (40 * (t / durationSec));
        const env = Math.sin(Math.PI * (t / durationSec));
        const s1 = Math.sin(2 * Math.PI * freq * t);
        const s2 = 0.3 * Math.sin(2 * Math.PI * (freq * 2) * t);
        const pcmSample = Math.round((s1 + s2) * 0.5 * gain * env * 32767);
        muLawBuffer[i] = encodeMuLaw(pcmSample);
    }
    return muLawBuffer;
}

function generateHaanBackchannelBuffer() {
    const sampleRate = 8000;
    const durationSec = 0.30; // 300ms "haan"
    const totalSamples = Math.floor(sampleRate * durationSec);
    const muLawBuffer = Buffer.alloc(totalSamples);
    const gain = 0.28;

    for (let i = 0; i < totalSamples; i++) {
        const t = i / sampleRate;
        const freq = 250 - (30 * (t / durationSec));
        const env = Math.sin(Math.PI * (t / durationSec));
        const s1 = Math.sin(2 * Math.PI * freq * t);
        const s2 = 0.4 * Math.sin(2 * Math.PI * (freq * 2) * t);
        const pcmSample = Math.round((s1 + s2) * 0.5 * gain * env * 32767);
        muLawBuffer[i] = encodeMuLaw(pcmSample);
    }
    return muLawBuffer;
}

const GLOBAL_AHAAN_BUFFER = generateAhaanBackchannelBuffer();
const GLOBAL_HMM_BUFFER = generateHmmBackchannelBuffer();
const GLOBAL_HAAN_BUFFER = generateHaanBackchannelBuffer();
const GLOBAL_BACKCHANNEL_POOL = [GLOBAL_AHAAN_BUFFER, GLOBAL_HMM_BUFFER, GLOBAL_HAAN_BUFFER];

// Twilio Media Stream Packet Streamer (Streams mu-law buffers in strict 160-byte 20ms frames to prevent Twilio frame drops)
function playBackchannelToTwilio(muLawBuffer, wsConn, streamSid) {
    if (!wsConn || wsConn.readyState !== ws.OPEN || !streamSid) return;
    const chunkSize = 160; // 20ms mu-law chunk size required by Twilio
    let offset = 0;
    const interval = setInterval(() => {
        if (offset >= muLawBuffer.length || wsConn.readyState !== ws.OPEN) {
            clearInterval(interval);
            return;
        }
        const chunk = muLawBuffer.subarray(offset, offset + chunkSize);
        offset += chunkSize;
        wsConn.send(JSON.stringify({
            event: 'media',
            streamSid: streamSid,
            media: { payload: chunk.toString('base64') }
        }));
    }, 20);
}

// Audio Signal Processing & Noise-Suppressed Stream Processor
function calculateRMS(pcm16Array) {
    let sumSquare = 0;
    for (let i = 0; i < pcm16Array.length; i++) {
        sumSquare += pcm16Array[i] * pcm16Array[i];
    }
    return Math.sqrt(sumSquare / pcm16Array.length);
}

class NoiseSuppressedAudioProcessor {
    constructor(options = {}) {
        this.noiseThreshold = options.noiseThreshold || 380; // RMS noise floor threshold
        this.bargeInThreshold = options.bargeInThreshold || 1800; // RMS needed for barge-in during AI playback
        this.isAiSpeaking = false;
        this.aiSpeakingTimeout = null;
        this.userSpeechDurationMs = 0;
        this.lastBackchannelTime = 0;
    }

    markAiSpeaking(durationMs = 1200) {
        this.isAiSpeaking = true;
        this.userSpeechDurationMs = 0;
        if (this.aiSpeakingTimeout) clearTimeout(this.aiSpeakingTimeout);
        this.aiSpeakingTimeout = setTimeout(() => {
            this.isAiSpeaking = false;
        }, durationMs);
    }

    processFrame(pcm16Chunk) {
        const rms = calculateRMS(pcm16Chunk);
        let shouldBackchannel = false;

        // If AI is currently outputting voice to caller, filter out mic noise completely unless loud barge-in
        if (this.isAiSpeaking) {
            this.userSpeechDurationMs = 0;
            if (rms < this.bargeInThreshold) {
                return { pcmOutput: new Int16Array(pcm16Chunk.length).fill(0), rms, isVoice: false, shouldBackchannel: false };
            } else {
                this.isAiSpeaking = false;
                if (this.aiSpeakingTimeout) clearTimeout(this.aiSpeakingTimeout);
            }
        }

        if (rms < this.noiseThreshold) {
            this.userSpeechDurationMs = 0;
            // Replace room noise/static/hum with pure zero silence
            return { pcmOutput: new Int16Array(pcm16Chunk.length).fill(0), rms, isVoice: false, shouldBackchannel: false };
        } else {
            // Active human voice detected! Pass raw audio frame
            this.userSpeechDurationMs += 20; // 20ms frame
            const now = Date.now();
            // Trigger mid-speech backchannel at 1.0s into continuous user speech
            if (this.userSpeechDurationMs >= 1000 && (now - this.lastBackchannelTime > 2800)) {
                this.lastBackchannelTime = now;
                this.userSpeechDurationMs = 0;
                shouldBackchannel = true;
            }
            return { pcmOutput: pcm16Chunk, rms, isVoice: true, shouldBackchannel };
        }
    }
}






// WSS Handlers
wss.on('connection', (wsConnection, req) => {
    let urlObj = null;
    try {
        urlObj = new URL(req.url, 'http://localhost');
    } catch (e) {}

    const queryLeadId = urlObj?.searchParams?.get('leadId');
    const queryProfileId = urlObj?.searchParams?.get('profileId');
    const queryCampaignId = urlObj?.searchParams?.get('campaignId');
    const queryTelephony = urlObj?.searchParams?.get('telephony');

    let isVobiz = queryTelephony === 'vobiz';
    let vobizStreamId = null;
    let vobizCallId = null;
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
    let leadPhone = null;
    let leadName = 'there';

    const transcriptTurns = [];
    let greetingPlayed = false;
    let voiceName = 'Aoede';

    const audioProcessor = new NoiseSuppressedAudioProcessor();
    let ringbackInterval = null;
    let ringbackOffset = 0;
    let geminiGreetingStarted = false;

    // Connection health check (heartbeat to prevent lingering ghost connections)
    let isAlive = true;
    wsConnection.on('pong', () => { isAlive = true; });

    const pingInterval = setInterval(() => {
        if (!isAlive) {
            console.log('[BRIDGE] WS connection timed out. Closing...');
            clearInterval(pingInterval);
            if (ringbackInterval) clearInterval(ringbackInterval);
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

            if (audioBufferSamples >= 1280) {
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
                    vobizCallId = data.callId || data.callUuid || data.start?.callSid;
                    vobizContentType = data.mediaFormat?.contentType || 'audio/x-l16';
                    twilioStreamSid = vobizStreamId;
                    leadId = data.customParameters?.leadId || data.start?.customParameters?.leadId || queryLeadId;
                    profileId = data.customParameters?.profileId || data.start?.customParameters?.profileId || queryProfileId;
                    var campaignId = data.customParameters?.campaignId || data.start?.customParameters?.campaignId || queryCampaignId;
                    greetingPlayed = (data.customParameters?.greetingPlayed || data.start?.customParameters?.greetingPlayed) === 'true';
                    voiceName = data.customParameters?.voiceName || data.start?.customParameters?.voiceName || 'Aoede';
                    console.log(`[BRIDGE] Vobiz stream started. StreamId: ${vobizStreamId}, CallId: ${vobizCallId}, Format: ${vobizContentType}, leadId: ${leadId}, profileId: ${profileId}`);
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

                // Start instant phone ringback tone stream to caller while Gemini WS setup takes place
                if (!ringbackInterval) {
                    console.log('[BRIDGE] Playing instant phone ringback tone while connecting to Gemini...');
                    ringbackInterval = setInterval(() => {
                        if (wsConnection.readyState === ws.OPEN && (twilioStreamSid || vobizStreamId) && !geminiGreetingStarted) {
                            const chunk = GLOBAL_RINGBACK_BUFFER.subarray(ringbackOffset, ringbackOffset + 160);
                            ringbackOffset += 160;
                            if (ringbackOffset >= GLOBAL_RINGBACK_BUFFER.length) ringbackOffset = 0;
                            if (isVobiz && vobizStreamId) {
                                wsConnection.send(JSON.stringify({
                                    event: 'playAudio',
                                    streamId: vobizStreamId,
                                    media: {
                                        contentType: 'audio/x-mulaw',
                                        sampleRate: 8000,
                                        payload: chunk.toString('base64')
                                    }
                                }));
                            } else if (twilioStreamSid) {
                                wsConnection.send(JSON.stringify({
                                    event: 'media',
                                    streamSid: twilioStreamSid,
                                    media: { payload: chunk.toString('base64') }
                                }));
                            }
                        } else if (geminiGreetingStarted && ringbackInterval) {
                            clearInterval(ringbackInterval);
                            ringbackInterval = null;
                        }
                    }, 20);
                }

                // 1. Fetch details from Supabase and connect to Gemini in parallel
                let systemInstruction = 'You are a helpful representative. Focus on booking an appointment.';
                let greetingMessage = 'Hi, kaise ho aap?';

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

                let dbPromise;
                let tempSocket;
                const defaultApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';

                const prewarmed = prewarmedPool.get(leadId);
                if (prewarmed && !prewarmed.used) {
                    console.log(`[BRIDGE] Found PRE-WARMED session for lead ${leadId}! Reusing pre-fetched socket & DB context...`);
                    prewarmed.used = true;
                    prewarmedPool.delete(leadId);
                    dbPromise = prewarmed.dbPromise;
                    tempSocket = prewarmed.tempSocket;
                } else {
                    const campaignPromise = campaignId
                        ? supabaseAdmin.from('voice_campaigns').select('*').eq('id', campaignId).maybeSingle()
                        : Promise.resolve({ data: null });

                    dbPromise = Promise.all([
                        supabaseAdmin.from('profiles').select('*').eq('id', profileId).maybeSingle(),
                        supabaseAdmin.from('leads').select('*').eq('id', leadId).maybeSingle(),
                        supabaseAdmin.from('properties').select('*').eq('user_id', profileId).limit(5),
                        campaignPromise,
                        supabaseAdmin.from('flagged_questions').select('*').eq('lead_id', leadId).eq('resolved', true).not('answer', 'is', null)
                    ]);

                    console.log('[BRIDGE] Connecting to Gemini Live WebSocket concurrently...');
                    tempSocket = new ws(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${defaultApiKey || ''}`);
                }


                let profile = null;
                let lead = null;
                let props = null;
                let campaign = null;
                let resolvedQuestions = [];

                try {
                    const [profileRes, leadRes, propsRes, campaignRes, flaggedRes] = await dbPromise;
                    lead = leadRes.data;
                    const effectiveProfileId = (lead && lead.user_id) ? lead.user_id : profileId;

                    if (effectiveProfileId && (effectiveProfileId !== profileId || !profileRes.data)) {
                        const { data: ownerProfile } = await supabaseAdmin
                            .from('profiles')
                            .select('*')
                            .eq('id', effectiveProfileId)
                            .maybeSingle();
                        profile = ownerProfile || profileRes.data;

                        const { data: ownerProps } = await supabaseAdmin
                            .from('properties')
                            .select('*')
                            .eq('user_id', effectiveProfileId)
                            .limit(5);
                        props = ownerProps || propsRes.data;
                    } else {
                        profile = profileRes.data;
                        props = propsRes.data;
                    }

                    profileData = profile;
                    campaign = campaignRes ? campaignRes.data : null;
                    resolvedQuestions = flaggedRes?.data || [];

                    if (lead) {
                        leadPhone = lead.phone;
                        leadName = lead.name || 'there';
                        
                        // Build Product Context
                        let productContext = '';
                        let interestedPropertyTitle = null;
                        if (lead.property_id) {
                            const { data: prop } = await supabaseAdmin
                                .from('properties')
                                .select('*')
                                .eq('id', lead.property_id)
                                .maybeSingle();
                            if (prop) {
                                interestedPropertyTitle = prop.title || null;
                                productContext = `<interested_property>
  <title>${prop.title || 'N/A'}</title>
  <type>${prop.property_type || 'N/A'}</type>
  <price>${prop.price || 'N/A'}</price>
  <description>${prop.description || 'N/A'}</description>
</interested_property>`;
                            }
                        }

                        // Build Catalog Context with complete property details, internal tags & location
                        let catalogContext = '';
                        if (props && props.length > 0) {
                            catalogContext = props.map((p) => {
                                let tagList = [];
                                if (p.title) tagList.push(p.title);
                                if (p.configurations) {
                                    try {
                                        const parsed = typeof p.configurations === 'string' ? JSON.parse(p.configurations) : p.configurations;
                                        if (Array.isArray(parsed.tags)) tagList.push(...parsed.tags);
                                        if (Array.isArray(parsed.internal_tags)) tagList.push(...parsed.internal_tags);
                                        if (parsed.project_name) tagList.push(parsed.project_name);
                                        if (parsed.brand_name) tagList.push(parsed.brand_name);
                                        if (parsed.keywords) tagList.push(parsed.keywords);
                                    } catch (e) {}
                                }
                                const cleanTags = Array.from(new Set(tagList.filter(Boolean))).join(', ');

                                return `<property>
  <id>${p.id}</id>
  <title>${p.title || 'N/A'}</title>
  <project_name_tags>${cleanTags || 'N/A'}</project_name_tags>
  <type>${p.property_type || 'N/A'}</type>
  <price>${p.price || 'N/A'}</price>
  <location_address>${p.address || p.location || 'N/A'}</location_address>
  <description>${p.description || 'N/A'}</description>
  ${p.rera_number ? `<rera_number>${p.rera_number}</rera_number>` : ''}
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

                        // Parse Meta Ad Origin / Specific Product Attribution
                        let adName = lead.ad_name || '';
                        let adHeadline = '';
                        let adProductName = '';
                        let adCampaignName = '';
                        let adBody = '';

                        if (lead.custom_fields) {
                            try {
                                const customObj = typeof lead.custom_fields === 'string' ? JSON.parse(lead.custom_fields) : lead.custom_fields;
                                const origin = customObj?.meta_ad_origin || customObj;
                                if (origin) {
                                    if (!adName && origin.ad_name) adName = origin.ad_name;
                                    if (origin.headline) adHeadline = origin.headline;
                                    if (origin.product_name) adProductName = origin.product_name;
                                    if (origin.campaign_name) adCampaignName = origin.campaign_name;
                                    if (origin.body) adBody = origin.body;
                                }
                            } catch (e) {
                                console.warn('[BRIDGE] Could not parse custom_fields for ad origin:', e);
                            }
                        }

                        const cleanTargetProductName = (rawName) => {
                            if (!rawName || typeof rawName !== 'string') return null;
                            let clean = rawName.trim();
                            const lower = clean.toLowerCase();
                            if (lower.includes('ai optimized') || lower.includes('ad video') || lower.includes('form the') || lower.includes('name, email') || lower.includes('what is your budget') || /\b\d{8,}\b/.test(clean)) {
                                clean = clean.replace(/AI\s*optimized\s*ad\s*video\s*\d*/gi, '');
                                clean = clean.replace(/form\s+the\s+.*/gi, '');
                                clean = clean.replace(/Name,\s*Email,\s*Phone.*/gi, '');
                                clean = clean.replace(/What\s+is\s+your\s+budget.*/gi, '');
                                clean = clean.replace(/\b\d{8,}\b/g, '');
                                clean = clean.replace(/[-_]+/g, ' ');
                                clean = clean.trim();
                            }
                            if (!clean || clean.length < 3 || /^(ad|video|campaign|lead|form|test|creative|offer|project)$/i.test(clean)) {
                                return null;
                            }
                            return clean;
                        };

                        const rawTargetProduct = adProductName || interestedPropertyTitle || adHeadline || adName || null;
                        const isInbound = urlObj?.searchParams?.get('inbound') === 'true' || (lead?.source || '').toLowerCase().includes('inbound') || queryTelephony === 'inbound';
                        const targetProduct = cleanTargetProductName(rawTargetProduct);

                        // Build proactive context instruction for the agent's second turn (after greeting response)
                        let sourceInstructions = "";
                        let contextInstruction = "";
                        const cleanSource = (lead?.source || '').toLowerCase();
                        const isFromAd = cleanSource.includes('facebook') || cleanSource.includes('fb') || cleanSource.includes('instagram') || cleanSource.includes('ad') || cleanSource.includes('meta');

                        if (isInbound) {
                            sourceInstructions = `\nThis is an INBOUND call from a customer calling ${companyName}.`;
                            contextInstruction = `   The caller has dialed in to ${companyName}. Greet them politely, introduce yourself from ${companyName}, and ask how you can assist them today. Answer all their questions about ${companyName}, features, pricing, products, or services based on the Business Context provided below.`;
                        } else if (isFirstCall) {
                            sourceInstructions = `\nThis is your FIRST call to this lead.`;
                            if (lead?.notes) {
                                contextInstruction = `   After the lead responds to your greeting, or if asked what this call is regarding, introduce yourself from ${companyName}. State clearly and naturally that you are calling regarding their specific inquiry/note: "${lead.notes}". Explain the features, capabilities, and solutions clearly and warmly based on what they asked for and the business info provided below. DO NOT talk about unrelated topics like real estate/properties unless their note or inquiry explicitly asks for it!`;
                            } else if (isFromAd && targetProduct) {
                                contextInstruction = `   After the lead responds to your greeting, or if asked what this call is regarding, explicitly reference the SPECIFIC project/product they showed interest in ("${targetProduct}"). Say something like: "Aapne ${companyName} ki ad dekhi thi ${targetProduct} ke regarding, main usi ke regarding complete details share karne ke liye call kar rahi hoon." If asked "kiske regarding call hai?", answer directly: "Ye call ${companyName} ke ${targetProduct} ke regarding hai."`;
                            } else if (isFromAd) {
                                contextInstruction = `   After the lead responds to your greeting, or if asked what this call is regarding, say: "Aapne hamaari ad dekhi hogi ${companyName} ki, ussi ke regarding call kar rahi hoon."`;
                            } else if (targetProduct) {
                                contextInstruction = `   After the lead responds to your greeting, or if asked what this call is regarding, introduce yourself from ${companyName}. Say something like: "Main ${companyName} se ${targetProduct} ke regarding call kar rahi hoon, aapki requirement/inquiry ke regarding." Then naturally ask how you can assist them.`;
                            } else {
                                contextInstruction = `   After the lead responds to your greeting, introduce yourself from ${companyName}. ${profile?.business_info ? `Briefly mention what the business deals in based on this info: "${profile.business_info.substring(0, 200).replace(/"/g, "'")}"` : ''} Say something like: "Main ${companyName} se baat kar rahi hoon, aapki requirement/inquiry ke regarding call kar rahi hoon." Then naturally ask how you can help them.`;
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

                        // Parse campaign greeting if available, otherwise default to warm Hindi greeting
                        let rawGreeting = campaign?.audience_filter?.greeting || null;
                        greetingMessage = '';

                        if (isInbound) {
                            greetingMessage = `Namaste! ${companyName} mein call karne ke liye dhanyawad. Main aapki kya madad kar sakti hoon?`;
                        } else if (rawGreeting) {
                            greetingMessage = rawGreeting
                                .replace(/\{name\}/gi, firstName)
                                .replace(/\{firstname\}/gi, firstName)
                                .replace(/\{leadname\}/gi, leadName);
                        } else if (resolvedQuestions.length > 0) {
                            greetingMessage = `Hi ${firstName} ji! Main assistant baat kar rahi hoon. Aapne pichli call mein jo sawal pucha tha, uska answer humare paas aa gaya hai. Main aapke doubts clear karne ke liye call kar rahi hoon. Kaise hain aap?`;
                        } else {
                            greetingMessage = `Hi ${firstName} ji, kaise ho aap?`;
                        }

                        const languageDirective = `
MANDATORY LANGUAGE & GREETING RULES:
1. You MUST speak in natural, warm, polite Hindi / Hinglish.
2. Default to Hindi / Hinglish for all responses. NEVER speak in pure English unless the user explicitly speaks to you in pure English first.
3. Your ONLY opening greeting is: "${greetingMessage}". Speak this exact greeting clearly and warmly.
4. DO NOT say "Hi", "Hello", "Good morning", or any extra greetings before or after "${greetingMessage}". NEVER repeat greetings or say multiple greetings in one turn.
`.trim();

                        if (campaign && campaign.custom_prompt) {
                            systemInstruction = `
${languageDirective}

${campaign.custom_prompt}

${sourceInstructions}
${contextInstruction}
${resolvedQuestionsInstruction}

--- LEAD & BUSINESS CONTEXT ---
Business Name: ${companyName}
Business Info: ${profile?.business_info || 'N/A'}
Lead Name: ${leadName}
Lead Phone: ${leadPhone || 'N/A'}
Notes/Requirement: ${lead?.notes || 'None'}
${productContext ? `--- LEAD INTEREST ---\n${productContext}\n` : ''}
${catalogContext ? `--- CATALOG / OFFERINGS ---\n${catalogContext}\n` : ''}
${previousCallsHistory ? `--- PREVIOUS CALL HISTORY ---\n${previousCallsHistory}\n` : ''}
${whatsappHistory ? `--- PREVIOUS WHATSAPP HISTORY ---\n${whatsappHistory}\n` : ''}
`.trim();
                        } else {
                            systemInstruction = `
You are a professional, helpful AI representative calling on behalf of "${companyName}".
Your primary objective is to assist the lead, ${leadName}, regarding ${lead?.notes ? `"${lead.notes}"` : (targetProduct || 'their inquiry for ' + companyName)}, answer their questions thoroughly based on the business info below, and schedule a consultation or demo if they are interested.

CONVERSATION FLOW:
1. Your opening greeting is: "${greetingMessage}".
2. Once the lead responds to your greeting, your NEXT response must proactively establish context:
${contextInstruction}
3. After establishing context, act as a helpful advisor. Focus on answering their queries and explaining the features/offerings based on the business info below.

CRITICAL RULES (NATURAL HELPFUL AGENT & CLOSED-WORLD GROUNDING):
1. STRICT CLOSED-WORLD ASSUMPTION: You must ONLY speak about the facts explicitly provided in the business profile info, catalog, and lead details.
2. NO HALLUCINATIONS: Do NOT assume, extrapolate, guess, or invent any information if not explicitly written in the context below.
3. NATURAL HELPFUL AGENT (NO AGGRESSIVE PITCHING): You are a friendly, helpful representative for "${companyName}". Focus on helping the lead and answering their questions first. DO NOT ask to book an appointment/consultation in every single response. Only suggest a consultation or demo naturally when they express interest.
4. UNANSWERABLE QUESTIONS: If a user asks a question about the business or offerings that is not explicitly answered in the context provided below, reply naturally: "That is a great question. I don't have that specific detail right now, but let's book a quick consultation call so our team can get that exact info for you."
5. Be polite, friendly, warm, and concise. Keep responses under 40 words.
6. LANGUAGE STYLE: Speak in a natural, friendly mix of Hindi and English (Hinglish) when responding to the user.
7. ENDING THE CALL: Once the call objective is met or the lead wants to end, say a brief polite goodbye and trigger your "end_call" tool to hang up the call immediately.
8. GENDER & PRONOUNS: You are a female representative calling on behalf of ${companyName}. Always use female grammar and pronouns in Hinglish (e.g. "kar rahi hoon", "karti hoon", "baat kar rahi hoon", "bata sakti hoon"). NEVER say "raha" or refer to yourself as a generic assistant.
9. APPLE LIVE VOICEMAIL & CALL SCREENING PROTOCOL: If you detect that an automated screening robot is speaking:
   - State your name & reason clearly once: "Hi, I am calling from ${companyName} regarding ${lead?.notes || targetProduct || 'your inquiry'} for ${firstName}. Please connect the call."
   - Then WAIT silently for the human prospect to press answer and speak before resuming your normal conversation.
10. VOICEMAIL DETECTION: If you hear an automated machine prompt to leave a message after the beep, trigger "end_call" to hang up.
11. SPECIFICITY RULE: When the prospect asks "Aap kiske regarding call kar rahe ho?", "Kiska call hai?", or "What is this call about?", state the reason clearly: ${lead?.notes ? `"Main ${companyName} se aapke note / inquiry (${lead.notes}) ke regarding call kar rahi hoon."` : (targetProduct ? `"Main ${companyName} se ${targetProduct} ke regarding call kar rahi hoon."` : `"Main ${companyName} se aapki inquiry ke regarding call kar rahi hoon."`)}
12. NATURAL BACKCHANNELING & HUMAN FILLERS: You MUST naturally use short Hinglish backchannels such as "Hmm", "Haan", "Ahaan", "Ji", "Hmm-mm" to acknowledge the lead while listening or at the start of your response turns (e.g., "Hmm, right", "Ahaan, samjha", "Haan ji").

${sourceInstructions}
${resolvedQuestionsInstruction}

--- BUSINESS CONTEXT ---
Business Name: ${companyName}
Business Info: ${profile?.business_info || 'N/A'}
Lead Name: ${leadName}
Lead Phone: ${leadPhone || 'N/A'}
Notes/Requirement: ${lead?.notes || 'None'}
${productContext ? `--- LEAD INTEREST ---\n${productContext}\n` : ''}
${catalogContext ? `--- CATALOG / OFFERINGS ---\n${catalogContext}\n` : ''}
${previousCallsHistory ? `--- PREVIOUS CALL HISTORY ---\n${previousCallsHistory}\n` : ''}
${whatsappHistory ? `--- PREVIOUS WHATSAPP HISTORY ---\n${whatsappHistory}\n` : ''}
`.trim();
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
                    tempSocket = new ws(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${customApiKey}`);
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
                             console.log('[BRIDGE] Gemini detected user interruption. Clearing audio buffer...');
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
                         
                         // Handle setup complete before sending greeting
                          if (serverMsg.setupComplete) {
                             console.log('[BRIDGE] Gemini Setup Complete received. Injecting greeting turn...');
                             
                             const textPrompt = greetingPlayed
                                 ? `The call has connected. We have already played the initial welcome greeting to the user: "${greetingMessage}". Do NOT repeat this greeting. Please wait silently for the user to respond first, and then reply naturally in Hinglish.`
                                 : `The call has just connected. Speak EXACTLY this greeting message now and nothing else: "${greetingMessage}"`;

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
                            if (!geminiGreetingStarted) {
                                geminiGreetingStarted = true;
                                if (ringbackInterval) {
                                    clearInterval(ringbackInterval);
                                    ringbackInterval = null;
                                    console.log('[BRIDGE] Gemini AI audio output started. Ringback tone stopped.');
                                }
                            }
                            audioProcessor.markAiSpeaking(1200);

                            for (const part of serverMsg.serverContent.modelTurn.parts) {
                                // Record agent text transcription
                                if (part.text) {
                                    console.log(`[Gemini Agent]: ${part.text}`);
                                    transcriptTurns.push({ role: 'agent', message: part.text });
                                }
                                
                                if (part.inlineData && part.inlineData.data) {
                                    const base64PCM = part.inlineData.data;

                                    if (isVobiz && wsConnection.readyState === ws.OPEN && vobizStreamId) {
                                        // Direct high-quality 24kHz Linear PCM to Vobiz!
                                        wsConnection.send(JSON.stringify({
                                            event: 'playAudio',
                                            streamId: vobizStreamId,
                                            media: {
                                                contentType: 'audio/x-l16',
                                                sampleRate: 24000,
                                                payload: base64PCM
                                            }
                                        }));
                                    } else if (wsConnection.readyState === ws.OPEN && twilioStreamSid) {
                                        // Downsample to 8kHz mu-law for Twilio
                                        const pcm24Bytes = Buffer.from(base64PCM, 'base64');
                                        const pcm24 = new Int16Array(pcm24Bytes.length / 2);
                                        for (let i = 0; i < pcm24.length; i++) {
                                            pcm24[i] = pcm24Bytes.readInt16LE(i * 2);
                                        }

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
                                    console.log(`[BRIDGE] Gemini triggered tool: end_call. Hanging up call (isVobiz: ${isVobiz})...`);
                                    
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

                                    // Trigger Call Termination & Close WebSocket with a 3-second delay
                                    // to allow in-flight audio (like goodbye dialogue) to finish playing to the lead.
                                    console.log('[BRIDGE] Waiting 3 seconds for audio playout before hanging up...');
                                    setTimeout(async () => {
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

                geminiSocket.on('close', async (code, reason) => {
                    const reasonStr = reason ? reason.toString() : '';
                    console.log(`[BRIDGE] Gemini Socket closed. Code: ${code}, Reason: ${reasonStr}`);
                    if (code === 1011 || reasonStr.includes('prepayment credits') || reasonStr.includes('billing')) {
                        console.error('[BRIDGE] CRITICAL: Google AI Studio prepayment credits are depleted for Gemini Live API!');
                        try {
                            if (leadId) {
                                await supabaseAdmin.from('lead_history').insert({
                                    lead_id: leadId,
                                    action_type: 'REMARK',
                                    description: `⚠️ AI Voice Call Error: Google AI Studio prepayment credits are depleted for the configured Gemini API key. Please recharge credits on Google AI Studio to resume Gemini Live voice calls.`
                                });
                            }
                        } catch (e) {}
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

                    const procRes = audioProcessor.processFrame(pcm16);

                    // Continuously send noise-suppressed 16kHz PCM audio stream to Gemini
                    sendPcmChunkToGemini(procRes.pcmOutput);

                    // If caller speaks continuously for >1.0s, stream a real-time vocal backchannel ("ahaan"/"hmm"/"haan")
                    if (procRes.shouldBackchannel && wsConnection.readyState === ws.OPEN) {
                        const randomBuf = GLOBAL_BACKCHANNEL_POOL[Math.floor(Math.random() * GLOBAL_BACKCHANNEL_POOL.length)];
                        console.log('[BRIDGE BACKCHANNEL] Playing real-time chunked mid-speech vocal backchannel...');
                        if (isVobiz && vobizStreamId) {
                            wsConnection.send(JSON.stringify({
                                event: 'playAudio',
                                streamId: vobizStreamId,
                                media: {
                                    contentType: 'audio/x-mulaw',
                                    sampleRate: 8000,
                                    payload: randomBuf.toString('base64')
                                }
                            }));
                        } else if (twilioStreamSid) {
                            playBackchannelToTwilio(randomBuf, wsConnection, twilioStreamSid);
                        }
                    }
                }
            }


            if (data.event === 'stop') {
                console.log(`[BRIDGE] Telephony stream stopped (${isVobiz ? 'Vobiz' : 'Twilio'}).`);
                if (ringbackInterval) {
                    clearInterval(ringbackInterval);
                    ringbackInterval = null;
                }
                wsConnection.close();
            }
        } catch (err) {
            console.error('[BRIDGE] Error processing Twilio stream packet:', err);
        }
    });

     wsConnection.on('close', async (code, reason) => {
        clearInterval(pingInterval);
        if (ringbackInterval) {
            clearInterval(ringbackInterval);
            ringbackInterval = null;
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

                // Use Gemini Flash API (REST) to generate summary & extract appointment booking slot
                let summary = 'Conversation took place via Gemini Voice AI.';
                let bookingTime = null;
                let callbackTime = null;
                let isQualified = false;

                try {
                    const analysisPrompt = `
You are analyzing a phone call transcript between an AI voice agent and a prospect.
Here is the transcript:
${fullTranscript}

Extract the following details as a valid JSON object ONLY. Do NOT use markdown tags, ticks, or backticks:
{
  "summary": "A concise, clean 2-3 sentence paragraph summarizing the call. Do NOT use markdown headers, bold, bullets, or lists.",
  "callback_time": "ISO-8601 string of requested callback date/time if requested/agreed (including 'call me tomorrow', 'connect Saturday', etc.). Current system UTC time is: ${new Date().toISOString()}",
  "booking_time": "ISO-8601 string of confirmed appointment/meeting/consultation/site visit date/time if the prospect agreed to, confirmed, requested, or accepted a meeting/appointment/visit slot (including 'tomorrow', 'Saturday', 'yes', 'okay', or confirming a proposed time), otherwise null. Current system UTC time is: ${new Date().toISOString()}",
  "is_qualified": true/false (true if the lead confirmed interest, answered questions, agreed to a visit/callback, or expressed interest)
}
`.trim();

                    const apiKeyToUse = profileData?.gemini_api_key || profile?.gemini_api_key || defaultApiKey;
                    const restUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKeyToUse}`;
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
                        try {
                            const parsed = JSON.parse(cleanJson);
                            if (parsed.summary) summary = parsed.summary.trim();
                            if (parsed.booking_time) bookingTime = parsed.booking_time;
                            if (parsed.callback_time) callbackTime = parsed.callback_time;
                            if (parsed.is_qualified) isQualified = true;
                        } catch (e) {
                            summary = rawText.trim();
                        }
                    }
                } catch (sumErr) {
                    console.error('[BRIDGE] Auto-analysis failed:', sumErr);
                }

                // Update leads table with summary, transcript, and stage transition
                const updatePayload = {
                    voice_call_status: 'completed',
                    voice_call_summary: summary,
                    voice_call_transcript: mergedTurns
                };

                if (bookingTime) {
                    console.log(`[BRIDGE] Detected booking slot from Gemini call: ${bookingTime}. Updating stage to Appointment Booked!`);
                    updatePayload.status = 'Appointment Booked';
                    updatePayload.pipeline_stage = 'Appointment Booked';
                    updatePayload.booked_time = bookingTime;
                } else {
                    if (!lead || !lead.pipeline_stage || lead.pipeline_stage === 'New Lead' || lead.pipeline_stage === 'New' || lead.status === 'New Lead' || lead.status === 'New') {
                        updatePayload.status = 'Ongoing';
                        updatePayload.pipeline_stage = 'Ongoing';
                    }
                }

                try {
                    await supabaseAdmin
                        .from('leads')
                        .update(updatePayload)
                        .eq('id', leadId);
                    console.log('[BRIDGE] Leads table summary, transcript, and pipeline stage updated successfully!');
                } catch (leadErr) {
                    console.error('[BRIDGE] Failed to save transcript/summary to lead:', leadErr);
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
                    recording_url: lead?.voice_recording_url || null,
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
