import fs from 'fs';
const content = fs.readFileSync('app/dashboard/flows/page.tsx', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('automations') || line.includes('from(') || line.includes('fetch(') || line.includes('selectedFlow') || line.includes('activeFlow')) {
    if (line.length < 120) {
      console.log(`Line ${idx + 1}: ${line.trim()}`);
    }
  }
});
