const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'components', 'PricingSection.tsx');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split(/\r?\n/);

console.log("Line 90 (1-indexed):", JSON.stringify(lines[89]));
console.log("Line 169 (1-indexed):", JSON.stringify(lines[168]));
