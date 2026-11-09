// Full output of the hyperframes install attempt inside the live sandbox.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { Sandbox } from '@e2b/code-interpreter';
import fs from 'node:fs';

const key = (process.env.E2B_API_KEY || '').replace(/^["']|["']$/g, '').trim();
const cache = JSON.parse(fs.readFileSync('.nobogent/e2b_sandboxes.json', 'utf8'));
const entry = cache[process.env.DIAG_USER_ID || Object.keys(cache)[0]];

(async () => {
  if (!entry?.sandboxId) {
    console.log('no cached sandbox');
    return;
  }
  const sandbox = await Sandbox.connect(entry.sandboxId, { apiKey: key });
  console.log('connected to', entry.sandboxId.slice(0, 12) + '…\n');

  const show = async (label: string, cmd: string, timeoutMs = 240_000) => {
    console.log(`\n===== ${label}`);
    console.log(`$ ${cmd}`);
    try {
      const res = await sandbox.commands.run(cmd, { timeoutMs });
      console.log(`exit=${res.exitCode}`);
      if (res.stdout) console.log('stdout:\n' + res.stdout.slice(-2500));
      if (res.stderr) console.log('stderr:\n' + res.stderr.slice(-2500));
    } catch (err: any) {
      console.log('threw:', String(err?.message || err).slice(0, 800));
      if (err?.stdout) console.log('stdout:\n' + String(err.stdout).slice(-1200));
      if (err?.stderr) console.log('stderr:\n' + String(err.stderr).slice(-1200));
    }
  };

  await show('npm registry reachable?', 'curl -s -o /dev/null -w "%{http_code}" https://registry.npmjs.org/hyperframes || echo curl-failed');
  await show('npm config / proxy', 'npm config get registry; echo "---"; env | grep -i proxy || echo "no proxy vars"');
  await show('npx hyperframes (full)', 'npx -y hyperframes@latest --version 2>&1', 240_000);
  await show('npm install to a prefix (full)', 'mkdir -p /home/user/hf && cd /home/user/hf && npm init -y >/dev/null 2>&1; npm install hyperframes@0.9.26 --no-audit --no-fund 2>&1 | tail -40', 300_000);
})();
