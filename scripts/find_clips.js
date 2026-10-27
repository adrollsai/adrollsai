const fs = require('fs');
const content = fs.readFileSync('voice-bridge/server.js', 'utf-8');
const lines = content.split('\n');

console.log('Searching for playClipToCaller:');
lines.forEach((line, idx) => {
  if (line.includes('playClipToCaller')) {
    console.log(`L${idx + 1}: ${line.trim()}`);
  }
});
