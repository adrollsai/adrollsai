// List the Gemini models this key can use — read-only.
import fs from 'node:fs';

const env = fs.readFileSync('.env.local', 'utf8');
const get = (n) => {
  const m = env.match(new RegExp('^' + n + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
};

const key = get('GEMINI_API_KEY') || get('GOOGLE_GENERATIVE_AI_API_KEY');
if (!key) {
  console.log('no Gemini key found');
  process.exit(1);
}

const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=200`);
const json = await res.json();
if (!res.ok) {
  console.log('HTTP ' + res.status, JSON.stringify(json).slice(0, 400));
  process.exit(1);
}

const rows = (json.models || [])
  .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
  .map((m) => ({
    id: m.name.replace('models/', ''),
    input: (m.inputTokenLimit || 0).toLocaleString(),
    methods: (m.supportedGenerationMethods || []).join(','),
  }));

console.log(`total generateContent models: ${rows.length}\n`);
for (const r of rows) console.log(`${r.id.padEnd(46)} in=${r.input}`);
