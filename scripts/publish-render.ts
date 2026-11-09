/**
 * Verifies the rendered video and publishes it to R2 so it can be watched.
 * Reuses the app's own upload path (lib/agent/sandbox).
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { Sandbox } from '@e2b/code-interpreter';
import fs from 'node:fs';
import { uploadSandboxArtifactToR2 } from '../lib/agent/sandbox';

const key = (process.env.E2B_API_KEY || '').replace(/^["']|["']$/g, '').trim();
const cache = JSON.parse(fs.readFileSync('.nobogent/e2b_sandboxes.json', 'utf8'));
const userId = process.env.DIAG_USER_ID || Object.keys(cache)[0];
const entry = cache[userId];
const PROJECT = process.env.DIAG_PROJECT || 'nobogent_ai_reel';
const FILE = `/home/user/${PROJECT}/out.mp4`;

(async () => {
  const sandbox = await Sandbox.connect(entry.sandboxId, { apiKey: key });

  const probe = await sandbox.commands.run(
    `ffprobe -v error -show_entries format=duration,size,format_name -show_entries stream=codec_name,width,height,r_frame_rate -of default=noprint_wrappers=1 ${FILE}`,
    { timeoutMs: 60_000 }
  );
  console.log('=== ffprobe ===');
  console.log((probe.stdout || probe.stderr || '').trim());

  console.log('\n=== publishing to R2 ===');
  const url = await uploadSandboxArtifactToR2(FILE, userId);
  console.log('public URL:', url);
})();
