const fs = require('fs');
const content = fs.readFileSync('voice-bridge/server.js', 'utf-8');

try {
  new Function(content);
  console.log('✓ Syntax is 100% valid');
} catch (e) {
  console.error('✗ Syntax Error:', e);
}
