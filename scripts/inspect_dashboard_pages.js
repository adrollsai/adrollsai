const fs = require('fs');

const files = [
  'app/dashboard/qualifying/page.tsx',
  'app/dashboard/flows/page.tsx',
  'app/dashboard/whatsapp-automation/page.tsx',
  'app/api/flows/route.ts',
  'app/api/flows/generate/route.ts',
  'app/api/flows/mcp/route.ts',
  'app/api/whatsapp/flows/route.ts',
  'app/api/whatsapp/question-flows/route.ts'
];

files.forEach(f => {
  if (fs.existsSync(f)) {
    console.log('=== ' + f + ' ===');
    const content = fs.readFileSync(f, 'utf8');
    const matches = content.match(/from\(['"]([a-zA-Z0-9_-]+)['"]\)/g) || [];
    console.log('Tables used:', Array.from(new Set(matches)));
  }
});
