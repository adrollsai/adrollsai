/**
 * Kill the cached E2B sandbox and forget it, so the next call provisions a clean VM.
 *
 * My /tmp bind-mount fix corrupted this instance's package state mid-test (apt could no longer
 * download, so the headless browser could not be installed). A fresh sandbox is the honest reset.
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { Sandbox } from '@e2b/code-interpreter';

dotenv.config({ path: '.env.local', quiet: true });

const CACHE_FILE = path.join(process.cwd(), '.nobogent', 'e2b_sandboxes.json');
if (!fs.existsSync(CACHE_FILE)) {
  console.log('no sandbox cache file — nothing to reset');
  process.exit(0);
}

const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
const entries = Array.isArray(raw) ? raw : Object.values(raw);
console.log('cached entries:', JSON.stringify(raw).slice(0, 300));

let killed = 0;
for (const entry of entries as any[]) {
  const id = entry?.sandboxId || entry?.id || entry?.sandbox_id;
  if (!id) continue;
  try {
    const sbx = await Sandbox.connect(id, { apiKey: process.env.E2B_API_KEY });
    await sbx.kill();
    console.log('killed', id);
    killed++;
  } catch (error: any) {
    console.log('could not kill', id, '—', String(error?.message || error).slice(0, 120));
  }
}

fs.writeFileSync(CACHE_FILE, JSON.stringify({}), 'utf8');
console.log(`killed ${killed} sandbox(es); cache cleared`);
