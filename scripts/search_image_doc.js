const fs = require('fs');
const content = fs.readFileSync('C:/Users/Adrolls/.gemini/antigravity-ide/brain/70c62b3d-13fb-436a-a84b-cec39c5e99f5/.system_generated/steps/711/content.md', 'utf8');
let pos = 0;
while (true) {
  const idx = content.indexOf('"Image"', pos);
  if (idx === -1) break;
  console.log('--- IMAGE AT ' + idx + ' ---');
  console.log(content.substring(idx - 50, idx + 400));
  pos = idx + 20;
}
