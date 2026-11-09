// Read-only probe: do the harness tables exist in the live Supabase project?
// Never prints secrets — only status codes and error codes.
import fs from 'node:fs';

const env = fs.readFileSync('.env.local', 'utf8');
const get = (n) => {
  const m = env.match(new RegExp('^' + n + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
};

const url = get('NEXT_PUBLIC_SUPABASE_URL');
const anon = get('NEXT_PUBLIC_SUPABASE_ANON_KEY') || get('SUPABASE_ANON_KEY');

if (!url || !anon) {
  console.log('missing env: url=' + Boolean(url) + ' anon=' + Boolean(anon));
  process.exit(1);
}

// Show only the project ref, never the full URL.
console.log('project: ' + (url.match(/https:\/\/([a-z0-9]+)\./) || [, '?'])[1]);

for (const table of ['profiles', 'harness_sessions', 'harness_events', 'harness_workspaces']) {
  const res = await fetch(`${url}/rest/v1/${table}?select=id&limit=1`, {
    headers: { apikey: anon, Authorization: `Bearer ${anon}` },
  });
  const body = await res.text();
  let summary = body.slice(0, 160);
  try {
    const j = JSON.parse(body);
    if (j && j.code) summary = `${j.code}: ${j.message}`;
  } catch {
    /* keep raw */
  }
  console.log(`${table.padEnd(20)} -> ${res.status}  ${summary}`);
}
