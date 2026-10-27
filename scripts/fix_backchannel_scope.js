const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'voice-bridge', 'server.js');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Move isCallHangingUp to connection level
content = content.replace(
    /const audioProcessor = new NoiseSuppressedAudioProcessor\(\);(\r?\n)/,
    'const audioProcessor = new NoiseSuppressedAudioProcessor();$1    let isCallHangingUp = false;$1'
);

// 2. Remove redundant let inside start block
content = content.replace(
    /let isCallHangingUp = false;(\r?\n\s*const triggerCallHangup)/,
    'isCallHangingUp = false;$1'
);

// 3. Optimize thresholds in NoiseSuppressedAudioProcessor
content = content.replace(
    /this\.voiceThreshold = options\.voiceThreshold \|\| 350;/,
    'this.voiceThreshold = options.voiceThreshold || 250;'
);
content = content.replace(
    /this\.backchannelTriggerDurationMs = options\.backchannelTriggerDurationMs \|\| 2300;[^\r\n]*/,
    'this.backchannelTriggerDurationMs = options.backchannelTriggerDurationMs || 1800; // Trigger after ~1.8s continuous caller speech'
);
content = content.replace(
    /this\.backchannelCooldownMs = options\.backchannelCooldownMs \|\| 6000;[^\r\n]*/,
    'this.backchannelCooldownMs = options.backchannelCooldownMs || 4500; // 4.5s cooldown'
);

// 4. Update silence tolerance from 450 to 600ms
content = content.replace(
    /now - this\.callerSilenceStartTime > 450/,
    'now - this.callerSilenceStartTime > 600'
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully fixed isCallHangingUp scope and optimized backchannel timing in server.js!');
