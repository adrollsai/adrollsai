const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'voice-bridge', 'server.js');
let content = fs.readFileSync(filePath, 'utf8');

const target = `                                    if (isVobiz && wsConnection.readyState === ws.OPEN && vobizStreamId) {
                                        // Pure, crystal-clear 24kHz studio PCM - clean voice without ambient noise
                                        const mixedBuf = Buffer.from(pcm24.buffer, pcm24.byteOffset, pcm24.byteLength);
                                        wsConnection.send(JSON.stringify({
                                            event: 'playAudio',
                                            streamId: vobizStreamId,
                                            media: {
                                                contentType: 'audio/x-l16',
                                                sampleRate: 24000,
                                                payload: mixedBuf.toString('base64')
                                            }
                                        }));
                                    }`;

const replacement = `                                    if (isVobiz && wsConnection.readyState === ws.OPEN && vobizStreamId) {
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
                                    }`;

// Normalize CRLF to LF for matching
const normContent = content.replace(/\r\n/g, '\n');
const normTarget = target.replace(/\r\n/g, '\n');
const normReplacement = replacement.replace(/\r\n/g, '\n');

if (!normContent.includes(normTarget)) {
  console.error('Target block not found in server.js!');
  process.exit(1);
}

const updatedNorm = normContent.replace(normTarget, normReplacement);
// Write with CRLF
fs.writeFileSync(filePath, updatedNorm.replace(/\n/g, '\r\n'), 'utf8');
console.log('Successfully updated server.js to use downsampled 16kHz PCM for Vobiz!');
