const fs = require('fs');
const content = fs.readFileSync('C:/Users/Adrolls/.gemini/antigravity-ide/brain/70c62b3d-13fb-436a-a84b-cec39c5e99f5/.system_generated/steps/711/content.md', 'utf8');

const regex = /"type":\s*"([A-Z][A-Za-z0-9]+)"/g;
let match;
const found = new Set();
while ((match = regex.exec(content)) !== null) {
  found.add(match[1]);
}
console.log('Flow components found:', Array.from(found));
