/** Collect the async image task from the Procolor run, then download everything for inspection. */
import fs from 'node:fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';

dotenv.config({ path: '.env.local', quiet: true });
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const OWNER = '9c0748de-e3da-4ea1-b323-4ce736b5ca7c';
const OUT = 'C:\\Users\\Adrolls\\Desktop\\nobo-e2e\\procolor';
fs.mkdirSync(OUT, { recursive: true });

const ctx = await createAgentContext(admin, OWNER, { intentText: 'collect image task' });
const tools = ctx.tools as any;

const taskId = '9dd58e0bbc4e34eafb0f18871a3381fb';
for (let attempt = 0; attempt < 12; attempt++) {
  const res = await tools.check_media_task.execute({ taskId });
  const url = res?.imageUrl || res?.url || res?.result?.imageUrl || res?.result?.url || '';
  const status = String(res?.status ?? '');
  console.log(`attempt ${attempt + 1}: status=${status} url=${url ? 'yes' : 'no'}`);
  if (url) {
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    fs.writeFileSync(`${OUT}\\creative-2-the-set.png`, buf);
    console.log(`saved creative-2 (${(buf.length / 1024).toFixed(0)}KB): ${url}`);
    fs.writeFileSync(`${OUT}\\creative-2.url.txt`, url);
    break;
  }
  if (/fail|error/i.test(status)) {
    console.log('task failed:', JSON.stringify(res).slice(0, 300));
    break;
  }
  await new Promise((r) => setTimeout(r, 10000));
}

// Download everything we have for a look.
const results = JSON.parse(fs.readFileSync(`${OUT}\\results.json`, 'utf8'));
for (const [i, r] of results.results.entries()) {
  if (r.kind !== 'image') continue;
  const file = `${OUT}\\have-${i + 1}.png`;
  if (fs.existsSync(file)) continue;
  try {
    const buf = Buffer.from(await (await fetch(r.url)).arrayBuffer());
    fs.writeFileSync(file, buf);
    console.log(`downloaded image ${i + 1}: ${(buf.length / 1024).toFixed(0)}KB`);
  } catch (e: any) {
    console.log(`image ${i + 1} fetch failed: ${e?.message}`);
  }
}
for (const r of results.results) {
  if (r.kind === 'video') {
    const buf = Buffer.from(await (await fetch(r.url)).arrayBuffer());
    fs.writeFileSync(`${OUT}\\video-ad.mp4`, buf);
    console.log(`downloaded video: ${(buf.length / 1024 / 1024).toFixed(1)}MB`);
  }
}
