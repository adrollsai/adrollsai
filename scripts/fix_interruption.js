const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'voice-bridge', 'server.js');
let raw = fs.readFileSync(filePath, 'utf8');
const isCRLF = raw.includes('\r\n');
let lines = raw.split(/\r?\n/);

const startIdx = lines.findIndex(l => l.includes('// Handle user interruption (barge-in)'));
if (startIdx === -1) {
    console.error('Start index not found!');
    process.exit(1);
}

// Find the closing brace of this if block
let endIdx = -1;
for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].includes('// Handle setup complete before sending greeting')) {
        endIdx = i - 1;
        break;
    }
}

if (endIdx === -1) {
    console.error('End index not found!');
    process.exit(1);
}

const replacementLines = [
    "                         // Handle user interruption (barge-in)",
    "                         if (serverMsg.serverContent?.interrupted) {",
    "                             console.log('[BRIDGE] Gemini confirmed interruption. Clearing telephony audio playback buffer immediately...');",
    "                             userSpeakingActive = true;",
    "                             turnCompleteDispatched = false;",
    "                             clearTurnWatchdog();",
    "                             audioProcessor.clearAiSpeaking();",
    "                             if (wsConnection.readyState === ws.OPEN) {",
    "                                 if (isVobiz && vobizStreamId) {",
    "                                     wsConnection.send(JSON.stringify({",
    "                                         event: 'clearAudio',",
    "                                         streamId: vobizStreamId",
    "                                     }));",
    "                                 } else if (twilioStreamSid) {",
    "                                     wsConnection.send(JSON.stringify({",
    "                                         event: 'clear',",
    "                                         streamSid: twilioStreamSid",
    "                                     }));",
    "                                 }",
    "                             }",
    "                         }"
];

lines.splice(startIdx, endIdx - startIdx + 1, ...replacementLines);

fs.writeFileSync(filePath, lines.join(isCRLF ? '\r\n' : '\n'), 'utf8');
console.log('Successfully replaced interruption block!');
