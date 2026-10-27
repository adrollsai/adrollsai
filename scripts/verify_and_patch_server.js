const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'voice-bridge', 'server.js');
let c = fs.readFileSync(serverPath, 'utf8');

// Replace the effectiveLang line
c = c.replace(
  /const effectiveLang = sessionConfig\?\.defaultLanguage[\s\S]*?\n\s*if \(!openGreeting\)/g,
  `let effectiveLang = sessionConfig?.defaultLanguage || 'hinglish';
                    if (campPromptLower.includes('kannada')) effectiveLang = 'kannada';
                    else if (campPromptLower.includes('punjabi')) effectiveLang = 'punjabi';
                    else if (campPromptLower.includes('hindi')) effectiveLang = 'hindi';
                    else if (campPromptLower.includes('english')) effectiveLang = 'english';

                    if (!openGreeting)`
);

// Fix isIndianEn reference in accentDirective
c = c.replace('const accentDirective = isIndianEn', "const accentDirective = (effectiveLang === 'english')");

fs.writeFileSync(serverPath, c, 'utf8');

const acorn = require('acorn');
try {
  acorn.parse(c, { ecmaVersion: 'latest' });
  console.log('✅ ACORN VALIDATION PASSED: 0 SYNTAX ERRORS IN voice-bridge/server.js!');
} catch (e) {
  console.error('Acorn error:', e);
  process.exit(1);
}
