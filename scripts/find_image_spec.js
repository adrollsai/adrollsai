const fs = require('fs');
const content = fs.readFileSync('C:/Users/Adrolls/.gemini/antigravity-ide/brain/70c62b3d-13fb-436a-a84b-cec39c5e99f5/.system_generated/steps/711/content.md', 'utf8');

const regex = /children":\["Image"\]/g;
let m;
while ((m = regex.exec(content)) !== null) {
  console.log('--- FOUND AT', m.index);
  console.log(content.substring(m.index - 100, m.index + 1500));
}
