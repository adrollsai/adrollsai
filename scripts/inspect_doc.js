const fs = require('fs');
const content = fs.readFileSync('C:/Users/Adrolls/.gemini/antigravity-ide/brain/70c62b3d-13fb-436a-a84b-cec39c5e99f5/.system_generated/steps/711/content.md', 'utf8');

const regex = /"type":\s*"([A-Za-z0-9]+)"/g;
let match;
const types = new Set();
while ((match = regex.exec(content)) !== null) {
  types.add(match[1]);
}
console.log('Detected Flow component types:', Array.from(types));

// Also find any mention of image or media
const lines = content.split('\n');
lines.forEach((l, i) => {
  if (l.toLowerCase().includes('image') && l.toLowerCase().includes('component')) {
    console.log(`Line ${i}: ${l.substring(0, 150)}`);
  }
});
