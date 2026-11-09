/**
 * Where does render cost actually go?
 *
 * The render trace showed "workerCount":1 and "forceScreenshot":true for 450
 * frames in 213s — about 470ms per frame. This prints the CLI's own options so
 * we can see what is tunable (fps, concurrency, capture mode, quality).
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { Sandbox } from '@e2b/code-interpreter';
import fs from 'node:fs';

const key = (process.env.E2B_API_KEY || '').replace(/^["']|["']$/g, '').trim();
const cache = JSON.parse(fs.readFileSync('.nobogent/e2b_sandboxes.json', 'utf8'));
const entry = cache[process.env.DIAG_USER_ID || Object.keys(cache)[0]];

(async () => {
  let sandbox: any;
  try {
    sandbox = await Sandbox.connect(entry.sandboxId, { apiKey: key });
    const ping = await sandbox.commands.run('echo alive && node -v', { timeoutMs: 10_000 });
    if (ping.exitCode !== 0) throw new Error('not alive');
    console.log('connected, node', (ping.stdout || '').trim().split('\n').pop(), '\n');
  } catch (err: any) {
    console.log('sandbox gone:', String(err?.message || err).slice(0, 120));
    process.exit(0);
  }

  const show = async (label: string, cmd: string, timeoutMs = 120_000) => {
    console.log(`\n===== ${label}`);
    try {
      const res = await sandbox.commands.run(cmd, { timeoutMs });
      console.log(`exit=${res.exitCode}`);
      console.log(((res.stdout || '') + (res.stderr || '')).slice(0, 2600));
    } catch (err: any) {
      console.log('threw:', String(err?.message || err).slice(0, 300));
    }
  };

  await show('render --help', 'export PATH=/usr/local/bin:$PATH && npx -y hyperframes@latest render --help');
  await show('cpu info', 'nproc; grep -m1 "model name" /proc/cpuinfo; free -m | head -2');
  await show(
    'composition metadata',
    'ls -la /home/user/nobogent_ai_reel/ 2>/dev/null; grep -o "data-[a-z-]*=\\"[^\\"]*\\"" /home/user/nobogent_ai_reel/index.html 2>/dev/null | head -10'
  );
})();
