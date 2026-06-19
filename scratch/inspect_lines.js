const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'app', 'dashboard', 'creation', 'page.tsx');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

for (let i = 1310; i <= 1332; i++) {
    console.log(`${i}: ${JSON.stringify(lines[i-1])}`);
}
