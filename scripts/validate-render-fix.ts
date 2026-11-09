/**
 * Validates the HyperFrames fix on a real sandbox: install Node 22, install the
 * CLI, ensure the browser, then render the composition the agent already wrote.
 *
 * This is the same sequence provisioning now performs, run against the live
 * sandbox so we learn whether the render actually succeeds.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { Sandbox } from '@e2b/code-interpreter';
import fs from 'node:fs';

const key = (process.env.E2B_API_KEY || '').replace(/^["']|["']$/g, '').trim();
const cache = JSON.parse(fs.readFileSync('.nobogent/e2b_sandboxes.json', 'utf8'));
const entry = cache[process.env.DIAG_USER_ID || Object.keys(cache)[0]];
const PROJECT = process.env.DIAG_PROJECT || 'nobogent_ai_reel';

(async () => {
  const sandbox = await Sandbox.connect(entry.sandboxId, { apiKey: key });
  console.log('connected to', entry.sandboxId.slice(0, 12) + '…\n');

  const run = async (label: string, cmd: string, timeoutMs = 300_000) => {
    const started = Date.now();
    try {
      const res = await sandbox.commands.run(cmd, { timeoutMs });
      const secs = Math.round((Date.now() - started) / 1000);
      const out = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').slice(-6).join('\n   ');
      console.log(`${res.exitCode === 0 ? 'ok  ' : 'FAIL'} ${label} (${secs}s)\n   ${out.slice(0, 700)}`);
      return res.exitCode === 0;
    } catch (err: any) {
      console.log(`ERR  ${label}: ${String(err?.message || err).slice(0, 400)}`);
      return false;
    }
  };

  await run('node before', 'node -v');

  console.log('\n--- installing Node 22 ---');
  await run(
    'install node 22',
    [
      `NODE_VER=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/ | grep -o 'node-v22[0-9.]*-linux-x64.tar.xz' | head -1)`,
      `[ -n "$NODE_VER" ] || NODE_VER=node-v22.12.0-linux-x64.tar.xz`,
      `curl -fsSL "https://nodejs.org/dist/latest-v22.x/$NODE_VER" -o /tmp/node.tar.xz`,
      `sudo mkdir -p /opt/node22`,
      `sudo tar -xJf /tmp/node.tar.xz -C /opt/node22 --strip-components=1`,
      `sudo ln -sf /opt/node22/bin/node /usr/local/bin/node`,
      `sudo ln -sf /opt/node22/bin/npm /usr/local/bin/npm`,
      `sudo ln -sf /opt/node22/bin/npx /usr/local/bin/npx`,
      `rm -f /tmp/node.tar.xz`,
      `export PATH=/usr/local/bin:$PATH && node -v`,
    ].join(' && '),
    300_000
  );

  await run('node after (PATH=/usr/local/bin first)', 'export PATH=/usr/local/bin:$PATH && node -v && npm -v');

  console.log('\n--- hyperframes CLI ---');
  await run('hyperframes --version', 'export PATH=/usr/local/bin:$PATH && npx -y hyperframes@latest --version', 300_000);

  console.log('\n--- browser ---');
  await run(
    'chrome system libraries',
    'sudo apt-get update -qq && sudo apt-get install -y -qq libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 ' +
      'libcups2 libdrm2 libxkbcommon0 libatspi2.0-0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 ' +
      'libgbm1 libpango-1.0-0 libcairo2 libasound2 fonts-liberation 2>&1 | tail -3',
    300_000
  );
  await run('browser ensure', 'export PATH=/usr/local/bin:$PATH && npx -y hyperframes@latest browser ensure', 420_000);

  console.log(`\n--- render ${PROJECT} ---`);
  await run(
    'render',
    `export PATH=/usr/local/bin:$PATH TMPDIR=/home/user/tmp && mkdir -p /home/user/tmp && cd /home/user/${PROJECT} && ls -la index.html && npx -y hyperframes@latest render --output out.mp4; echo "exit=$?"; ls -la out.mp4 2>/dev/null || echo "NO out.mp4"`,
    600_000
  );

  const res = await sandbox.commands.run(`ls -la /home/user/${PROJECT}/out.mp4 2>/dev/null || echo missing`, {
    timeoutMs: 20_000,
  });
  console.log('\nfinal:', (res.stdout || res.stderr || '').trim());
})();
