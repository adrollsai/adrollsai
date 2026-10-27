const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'voice-bridge', 'server.js');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Update NoiseSuppressedAudioProcessor
const oldClass = `class NoiseSuppressedAudioProcessor {
    constructor(options = {}) {
        // Barge-in: RMS threshold for caller voice to be considered "speaking" during AI output
        // Telephony lines typically have RMS 50-200 for line noise, 400+ for speech
        this.bargeInThreshold = options.bargeInThreshold || 500;
        this.sustainedBargeInNeeded = options.sustainedBargeInFrames || 3; // 3 frames * 20ms = 60ms of sustained speech
        this.isAiSpeaking = false;
        this.aiSpeakingTimeout = null;
        this.sustainedBargeInFrames = 0;
        this.bargeInTriggered = false; // Set true when barge-in fires, reset when AI starts speaking again
    }

    markAiSpeaking(durationMs = 1200) {
        this.isAiSpeaking = true;
        this.bargeInTriggered = false;
        this.sustainedBargeInFrames = 0;
        if (this.aiSpeakingTimeout) clearTimeout(this.aiSpeakingTimeout);
        this.aiSpeakingTimeout = setTimeout(() => {
            this.isAiSpeaking = false;
            this.sustainedBargeInFrames = 0;
        }, durationMs);
    }

    clearAiSpeaking() {
        this.isAiSpeaking = false;
        this.sustainedBargeInFrames = 0;
        if (this.aiSpeakingTimeout) clearTimeout(this.aiSpeakingTimeout);
    }

    /**
     * CRITICAL DESIGN: We ALWAYS forward the caller's real audio to Gemini.
     * Gemini Live API requires continuous audio input to keep its session alive.
     * Sending zero-filled silence causes Gemini to think the user left and drop the connection.
     * 
     * The processor only DETECTS barge-in events — it does NOT gate audio.
     * Barge-in detection is used to send 'clearAudio' to Vobiz to stop AI playback.
     */
    processFrame(pcm16Chunk) {
        const rms = calculateRMS(pcm16Chunk);

        // Always forward real audio to Gemini — never send zeroes
        const result = { pcmOutput: pcm16Chunk, rms, isVoice: rms >= 300, bargeIn: false };

        // Check for barge-in during AI speech
        if (this.isAiSpeaking && !this.bargeInTriggered) {
            if (rms >= this.bargeInThreshold) {
                this.sustainedBargeInFrames++;
                if (this.sustainedBargeInFrames >= this.sustainedBargeInNeeded) {
                    // Caller is deliberately speaking over the AI
                    console.log(\`[AUDIO PROCESSOR] Barge-in detected! RMS: \${Math.round(rms)}, sustained \${this.sustainedBargeInFrames} frames\`);
                    this.bargeInTriggered = true;
                    this.isAiSpeaking = false;
                    this.sustainedBargeInFrames = 0;
                    if (this.aiSpeakingTimeout) clearTimeout(this.aiSpeakingTimeout);
                    result.bargeIn = true;
                }
            } else {
                // Reset sustained counter if a quiet frame breaks the streak
                this.sustainedBargeInFrames = Math.max(0, this.sustainedBargeInFrames - 1);
            }
        }

        return result;
    }
}`;

const newClass = `class NoiseSuppressedAudioProcessor {
    constructor(options = {}) {
        // Barge-in: RMS threshold for caller voice to be considered "speaking" during AI output
        // Telephony lines typically have RMS 50-200 for line noise, 400+ for speech
        this.bargeInThreshold = options.bargeInThreshold || 500;
        this.sustainedBargeInNeeded = options.sustainedBargeInFrames || 3; // 3 frames * 20ms = 60ms of sustained speech
        this.isAiSpeaking = false;
        this.aiSpeakingTimeout = null;
        this.sustainedBargeInFrames = 0;
        this.bargeInTriggered = false; // Set true when barge-in fires, reset when AI starts speaking again

        // Concurrent Backchanneling (saying "hmm", "ahan" while caller is speaking)
        this.voiceThreshold = options.voiceThreshold || 350;
        this.callerSpeechStartTime = 0;
        this.callerSilenceStartTime = 0;
        this.lastBackchannelTime = 0;
        this.backchannelTriggerDurationMs = options.backchannelTriggerDurationMs || 2300; // Trigger after ~2.3s continuous caller speech
        this.backchannelCooldownMs = options.backchannelCooldownMs || 6000; // Wait 6s before another backchannel
    }

    markAiSpeaking(durationMs = 1200) {
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

    /**
     * CRITICAL DESIGN: We ALWAYS forward the caller's real audio to Gemini.
     * Gemini Live API requires continuous audio input to keep its session alive.
     * Sending zero-filled silence causes Gemini to think the user left and drop the connection.
     * 
     * The processor only DETECTS barge-in and concurrent backchannel events — it does NOT gate audio.
     */
    processFrame(pcm16Chunk) {
        const rms = calculateRMS(pcm16Chunk);
        const isVoice = rms >= this.voiceThreshold;
        const now = Date.now();

        // Always forward real audio to Gemini — never send zeroes
        const result = {
            pcmOutput: pcm16Chunk,
            rms,
            isVoice,
            bargeIn: false,
            triggerBackchannel: false,
            backchannelClip: null,
            speechDurationMs: 0
        };

        // Check for barge-in during AI speech
        if (this.isAiSpeaking && !this.bargeInTriggered) {
            if (rms >= this.bargeInThreshold) {
                this.sustainedBargeInFrames++;
                if (this.sustainedBargeInFrames >= this.sustainedBargeInNeeded) {
                    // Caller is deliberately speaking over the AI
                    console.log(\`[AUDIO PROCESSOR] Barge-in detected! RMS: \${Math.round(rms)}, sustained \${this.sustainedBargeInFrames} frames\`);
                    this.bargeInTriggered = true;
                    this.isAiSpeaking = false;
                    this.sustainedBargeInFrames = 0;
                    if (this.aiSpeakingTimeout) clearTimeout(this.aiSpeakingTimeout);
                    result.bargeIn = true;
                }
            } else {
                // Reset sustained counter if a quiet frame breaks the streak
                this.sustainedBargeInFrames = Math.max(0, this.sustainedBargeInFrames - 1);
            }
        }

        // Concurrent Backchanneling: Detect when caller is speaking continuously (while AI is silent & listening)
        if (!this.isAiSpeaking) {
            if (isVoice) {
                this.callerSilenceStartTime = 0;
                if (!this.callerSpeechStartTime) {
                    this.callerSpeechStartTime = now;
                } else {
                    const speechDuration = now - this.callerSpeechStartTime;
                    result.speechDurationMs = speechDuration;

                    if (speechDuration >= this.backchannelTriggerDurationMs &&
                        (now - this.lastBackchannelTime) >= this.backchannelCooldownMs) {
                        result.triggerBackchannel = true;
                        result.backchannelClip = Math.random() < 0.5 ? 'backchannel_hmm' : 'backchannel_haan';
                        this.lastBackchannelTime = now;
                    }
                }
            } else {
                // Short pauses / breaths
                if (this.callerSpeechStartTime) {
                    if (!this.callerSilenceStartTime) {
                        this.callerSilenceStartTime = now;
                    } else if (now - this.callerSilenceStartTime > 450) {
                        // Caller finished turn / paused for > 450ms
                        this.callerSpeechStartTime = 0;
                        this.callerSilenceStartTime = 0;
                    }
                }
            }
        }

        return result;
    }
}`;

// 2. Update media handler
const oldMedia = `                    // ALWAYS forward real caller audio to Gemini — it needs continuous input
                    // to keep its session alive. The processor only detects barge-in events.
                    const procRes = audioProcessor.processFrame(pcm16);
                    sendPcmChunkToGemini(procRes.pcmOutput);

                    // If barge-in detected, send clearAudio to stop AI playback on the caller's end
                    if (procRes.bargeIn && wsConnection.readyState === ws.OPEN) {
                        console.log('[BRIDGE] Barge-in! Clearing AI audio playback to caller...');
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
                    }`;

const newMedia = `                    // ALWAYS forward real caller audio to Gemini — it needs continuous input
                    // to keep its session alive. The processor detects barge-in and backchannel events.
                    const procRes = audioProcessor.processFrame(pcm16);
                    sendPcmChunkToGemini(procRes.pcmOutput);

                    // If barge-in detected, send clearAudio to stop AI playback on the caller's end
                    if (procRes.bargeIn && wsConnection.readyState === ws.OPEN) {
                        console.log('[BRIDGE] Barge-in! Clearing AI audio playback to caller...');
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

                    // Concurrent Backchanneling: Play natural "hmm" or "ahan" while caller is actively talking
                    if (procRes.triggerBackchannel && geminiGreetingStarted && !isCallHangingUp && wsConnection.readyState === ws.OPEN) {
                        const clip = procRes.backchannelClip || 'backchannel_hmm';
                        console.log(\`[BRIDGE] Concurrent backchannel triggered: '\${clip}' (caller speech duration: \${procRes.speechDurationMs}ms)\`);
                        playClipToCaller(wsConnection, clip, isVobiz, vobizStreamId || twilioStreamSid);
                    }`;

if (!content.includes(oldClass)) {
    console.error('Old class not found!');
    process.exit(1);
}
content = content.replace(oldClass, newClass);

if (!content.includes(oldMedia)) {
    console.error('Old media handler not found!');
    process.exit(1);
}
content = content.replace(oldMedia, newMedia);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully added concurrent backchanneling to voice-bridge/server.js!');
