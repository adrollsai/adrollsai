const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'voice-bridge', 'server.js');
let content = fs.readFileSync(filePath, 'utf8');

// Helper to normalize line endings for matching
const crlf = content.includes('\r\n') ? '\r\n' : '\n';

// 1. Add isMaleVoice helper function near calculateRMS
const targetHelper = `function calculateRMS(pcm16Array) {`;
const newHelper = `function isMaleVoice(vName, gender) {
    const str = \`\${vName || ''} \${gender || ''}\`.toLowerCase();
    return str.includes('male') || str.includes('fenrir') || str.includes('puck') || str.includes('charon') || str.includes('orus') || str.includes('zephyr') || str.includes('alcor') || str.includes('umbriel') || str.includes('guy');
}

function calculateRMS(pcm16Array) {`;

content = content.replace(targetHelper, newHelper);

// 2. Clean NoiseSuppressedAudioProcessor - remove backchannel injection logic, keep clean barge-in
content = content.replace(
    /\/\/ Concurrent Backchanneling \(saying "hmm", "ahan" while caller is speaking\)[\s\S]*?this\.backchannelCooldownMs = options\.backchannelCooldownMs \|\| 4500; \/\/ 4\.5s cooldown/,
    `// Clean audio processor: ALWAYS forwards audio, detects user barge-in over AI speech`
);

content = content.replace(
    /\/\/ Concurrent Backchanneling: Detect when caller is speaking continuously[\s\S]*?return result;\s*\}/,
    `return result;
    }`
);

// 3. Remove triggerBackchannel properties from result object in processFrame
content = content.replace(
    /const result = \{\s*pcmOutput: pcm16Chunk,\s*rms,\s*isVoice,\s*bargeIn: false,\s*triggerBackchannel: false,\s*backchannelClip: null,\s*speechDurationMs: 0\s*\};/,
    `const result = { pcmOutput: pcm16Chunk, rms, isVoice: rms >= 300, bargeIn: false };`
);

// 4. Remove mid-speech backchannel playback block in media handler
content = content.replace(
    /\/\/ Concurrent Backchanneling: Play natural "hmm" or "ahan" while caller is actively talking[\s\S]*?playClipToCaller\(wsConnection, clip, isVobiz, vobizStreamId \|\| twilioStreamSid\);\s*\}/,
    `// Bridge-level injected backchannels removed — Gemini prompt handles natural Hinglish conversational nods organically`
);

// 5. Update vobiz-xml to pass voiceName in wsUrl
content = content.replace(
    /const wsUrl = `\$\{wsProtocol\}:\/\/\$\{host\}\/gemini-live-stream\?leadId=\$\{leadId\}&profileId=\$\{profileId\}&campaignId=\$\{campaignId\}&telephony=vobiz`;/,
    `const reqVoiceName = req.query.voiceName || req.body?.voiceName || '';
    const wsUrl = \`\${wsProtocol}://\${host}/gemini-live-stream?leadId=\${leadId}&profileId=\${profileId}&campaignId=\${campaignId}&telephony=vobiz\${reqVoiceName ? \`&voiceName=\${encodeURIComponent(reqVoiceName)}\` : ''}\`;`
);

// 6. Update WebSocket connection to parse voiceName from searchParams
content = content.replace(
    /const queryTelephony = urlObj\?\.searchParams\?\.get\('telephony'\) \|\| urlObj\?\.searchParams\?\.get\('amp;telephony'\);/,
    `const queryTelephony = urlObj?.searchParams?.get('telephony') || urlObj?.searchParams?.get('amp;telephony');
    const queryVoiceName = urlObj?.searchParams?.get('voiceName') || urlObj?.searchParams?.get('amp;voiceName');`
);

content = content.replace(
    /let voiceName = 'Aoede';/,
    `let voiceName = queryVoiceName || 'Aoede';`
);

// 7. Update voice selection for start event and initial pickup greeting
content = content.replace(
    /voiceName = data\.customParameters\?\.voiceName \|\| data\.start\?\.customParameters\?\.voiceName \|\| 'Aoede';/g,
    `voiceName = queryVoiceName || data.customParameters?.voiceName || data.start?.customParameters?.voiceName || voiceName || 'Aoede';`
);

content = content.replace(
    /const initialVoice = \(voiceName === 'Fenrir' \|\| voiceName === 'Charon'\) \? 'hello_male' : 'hello_female';/,
    `const isMale = isMaleVoice(voiceName, data.customParameters?.voice_gender || data.start?.customParameters?.voice_gender || profileData?.voice_gender || profile?.voice_gender);
                const initialVoice = isMale ? 'hello_male' : 'hello_female';
                console.log(\`[BRIDGE] Selected initial pickup greeting '\${initialVoice}' for voice '\${voiceName}' (isMale: \${isMale})\`);`
);

// 8. Update openGreeting gender agreement in sendInitialGreeting
content = content.replace(
    /const openGreeting = `Haan ji, \$\{nameGreeting\}, kaise hain aap\? Main \$\{safeCompanyName\} se bol rahi hoon, aapne \$\{safeProduct\} ke regarding inquiry ki thi\. Kya aapke paas do minute hain\?`;/,
    `const bolRaha = isMaleVoice(voiceName, profile?.voice_gender) ? 'bol raha hoon' : 'bol rahi hoon';
                    const openGreeting = \`Haan ji, \${nameGreeting}, kaise hain aap? Main \${safeCompanyName} se \${bolRaha}, aapne \${safeProduct} ke regarding inquiry ki thi. Kya aapke paas do minute hain?\`;`
);

// 9. Update playClipToCaller to mix subtle ambience into pickup greeting
content = content.replace(
    /function playClipToCaller\(wsConn, clipKey, isVobiz = true, streamId = null\) \{[\s\S]*?if \(!asset \|\| !wsConn \|\| wsConn\.readyState !== ws\.OPEN \|\| !streamId\) return;\s*/,
    `function playClipToCaller(wsConn, clipKey, isVobiz = true, streamId = null) {
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
`
);

content = content.replace(
    /payload: asset\.base64Pcm24/,
    `payload: payload24`
);

// 10. Mix subtle call center ambience into Gemini AI outgoing audio chunks
content = content.replace(
    /\/\/ Direct high-quality 24kHz Linear PCM to Vobiz with ambient office tone!\s*const mixedBuf = Buffer\.from\(pcm24\.buffer, pcm24\.byteOffset, pcm24\.byteLength\);/,
    `// Mix minimal volume call center ambience (~0.06) that enriches room presence without overshadowing speech
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

                                        const mixedBuf = Buffer.from(mixedPcm.buffer, mixedPcm.byteOffset, mixedPcm.byteLength);`
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated voice-bridge/server.js with male/female greeting, ambience mixing, and removed bridge backchannels!');
