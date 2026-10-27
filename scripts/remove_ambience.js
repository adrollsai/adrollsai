const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'voice-bridge', 'server.js');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Revert playClipToCaller to pure asset payload without ambience
const oldPlayClip = `function playClipToCaller(wsConn, clipKey, isVobiz = true, streamId = null) {
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
        // Send directly in 24kHz linear PCM to Vobiz
        wsConn.send(JSON.stringify({
            event: 'playAudio',
            streamId: streamId,
            media: {
                contentType: 'audio/x-l16',
                sampleRate: 24000,
                payload: payload24
            }
        }));`;

const newPlayClip = `function playClipToCaller(wsConn, clipKey, isVobiz = true, streamId = null) {
    const asset = AUDIO_ASSETS[clipKey];
    if (!asset || !wsConn || wsConn.readyState !== ws.OPEN || !streamId) return;

    if (isVobiz) {
        // Send directly in 24kHz linear PCM to Vobiz
        wsConn.send(JSON.stringify({
            event: 'playAudio',
            streamId: streamId,
            media: {
                contentType: 'audio/x-l16',
                sampleRate: 24000,
                payload: asset.base64Pcm24
            }
        }));`;

content = content.replace(oldPlayClip, newPlayClip);

// 2. Revert Gemini outgoing audio chunks to pure pcm24 without ambience
const oldMix = `// Mix minimal volume call center ambience (~0.06) that enriches room presence without overshadowing speech
                                        const mixedPcm = new Int16Array(pcm24.length);
                                        const ambAsset = AUDIO_ASSETS['ambience'];
                                        const ambSamples = ambAsset ? ambAsset.pcm24 : null;
                                        const ambVol = 0.06;

                                        for (let i = 0; i < pcm24.length; i++) {
                                            let s = pcm24[i];
                                            if (ambSamples) {
                                                const ambS = ambSamples[ambienceOffset % ambSamples.length];
                                                ambienceOffset++;
                                                s = Math.max(-32768, Math.min(32767, s + Math.round(ambS * ambVol)));
                                            }
                                            mixedPcm[i] = s;
                                        }

                                        const mixedBuf = Buffer.from(mixedPcm.buffer, mixedPcm.byteOffset, mixedPcm.byteLength);`;

const newMix = `// Pure, crystal-clear 24kHz studio PCM - clean voice without ambient noise
                                        const mixedBuf = Buffer.from(pcm24.buffer, pcm24.byteOffset, pcm24.byteLength);`;

content = content.replace(oldMix, newMix);

// 3. For Twilio branch, ensure downsampling uses pcm24
content = content.replace(
    /const pcm8 = downsample24To8\(mixedPcm\);/,
    'const pcm8 = downsample24To8(pcm24);'
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully removed ambient background sound from voice-bridge/server.js!');
