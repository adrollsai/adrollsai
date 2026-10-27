const fs = require('fs');
const content = fs.readFileSync('voice-bridge/server.js', 'utf-8');
const lines = content.split('\n');

console.log('Searching for playAudio, audioAssets, male, filler in server.js:');
lines.forEach((line, idx) => {
  if (line.includes('playAudio') || line.includes('audioAssets') || line.includes('filler_') || line.includes('hello_male')) {
    console.log(`L${idx + 1}: ${line.trim()}`);
  }
});
