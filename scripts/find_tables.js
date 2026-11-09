const fs = require('fs');
const path = require('path');

function getFiles(dir, files = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git'].includes(f.name)) continue;
    const full = path.join(dir, f.name);
    if (f.isDirectory()) getFiles(full, files);
    else if (/\.(ts|tsx|js)$/.test(f.name)) files.push(full);
  }
  return files;
}

const tables = new Set();
for (const file of getFiles('.')) {
  const content = fs.readFileSync(file, 'utf8');
  const matches = content.matchAll(/\.from\(['"]([a-zA-Z0-9_]+)['"]\)/g);
  for (const m of matches) tables.add(m[1]);
}
console.log('Tables used in app:', Array.from(tables).sort());

