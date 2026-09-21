import fs from 'fs';

const content = fs.readFileSync('app/dashboard/flows/page.tsx', 'utf8');
const lines = content.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('.title') && !line.includes('title:') && !line.includes('title =') && !line.includes('row.title') && !line.includes('data.title')) {
    console.log(`Line ${idx + 1}: ${line.trim()}`);
  }
});
