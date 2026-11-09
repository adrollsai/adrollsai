// Diagnose .env.local encoding damage without printing secret values.
import fs from 'node:fs';

const raw = fs.readFileSync('.env.local');
const hasBom = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
const text = raw.toString('utf8');

console.log('bytes:', raw.length);
console.log('UTF-8 BOM present:', hasBom);

const highBytes = [...raw].filter((b) => b > 127).length;
console.log('non-ASCII bytes:', highBytes);

const lines = text.split('\n');
let bad = 0;
lines.forEach((line, i) => {
  const nonAscii = [...line].filter((ch) => ch.charCodeAt(0) > 127);
  if (nonAscii.length) {
    bad++;
    const codes = nonAscii.slice(0, 6).map((c) => `U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(',');
    const isAssignment = /^[A-Za-z_][A-Za-z0-9_]*=/.test(line);
    console.log(`  line ${i + 1}${isAssignment ? ' [KEY=VALUE]' : ' [comment/other]'}: ${codes}  → ${JSON.stringify(line.slice(0, 90))}`);
  }
});
console.log('lines containing non-ASCII:', bad);

// Every variable name must be plain ASCII, or tooling refuses to parse the file.
const names = lines
  .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
  .map((l) => l.split('=')[0].trim());
const badNames = names.filter((n) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(n));
console.log('variable count:', names.length);
console.log('invalid variable names:', badNames.length ? JSON.stringify(badNames.slice(0, 5)) : 'none');
console.log('CRON_SECRET present:', names.includes('CRON_SECRET'));
