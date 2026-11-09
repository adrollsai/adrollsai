/**
 * Why did the HyperFrames render fail?
 *
 * Reconnects to the user's live E2B sandbox and reports what the image actually
 * has: ffmpeg, node, the hyperframes CLI, and a usable headless browser. Then
 * tries the browser install to capture the real error.
 *
 * Run: npx esbuild scripts/diag-sandbox.ts --bundle --platform=node --format=cjs \
 *        --outfile=.tmp-sandbox.cjs --log-level=warning && node .tmp-sandbox.cjs
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { Sandbox } from '@e2b/code-interpreter';

const key = (process.env.E2B_API_KEY || '').replace(/^["']|["']$/g, '').trim();

async function run(sandbox: any, label: string, cmd: string, timeoutMs = 60_000) {
  try {
    const res = await sandbox.commands.run(cmd, { timeoutMs });
    const out = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').slice(-4).join(' | ');
    console.log(`  ${res.exitCode === 0 ? 'ok  ' : 'FAIL'} ${label}: ${out.slice(0, 220)}`);
    return res.exitCode === 0;
  } catch (err: any) {
    console.log(`  ERR  ${label}: ${String(err?.message || err).slice(0, 220)}`);
    return false;
  }
}

(async () => {
  if (!key) {
    console.error('no E2B_API_KEY');
    process.exit(1);
  }

  const { data: profiles } = await import('@supabase/supabase-js').then((m) =>
    m
      .createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false },
      })
      .from('profiles')
      .select('id')
      .limit(1)
  );
  const userId = process.env.DIAG_USER_ID || (profiles![0].id as string);

  // The agent connects its sandbox by user id — reuse the same cache file.
  const fs = await import('node:fs');
  const cachePath = '.nobogent/e2b_sandboxes.json';
  let sandboxId: string | undefined;
  try {
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    sandboxId = cache[userId]?.sandboxId;
  } catch {
    /* no cache */
  }
  console.log('cached sandbox for user:', sandboxId ? sandboxId.slice(0, 12) + '…' : '(none)');
  if (!sandboxId) {
    console.log('No live sandbox cached — the render error happened on a sandbox that has since expired.');
    process.exit(0);
  }

  let sandbox: any;
  try {
    sandbox = await Sandbox.connect(sandboxId, { apiKey: key });
    await sandbox.setTimeout?.(120_000);
    console.log('connected\n');
  } catch (err: any) {
    console.log('could not reconnect (sandbox expired):', String(err?.message || err).slice(0, 200));
    process.exit(0);
  }

  console.log('=== what the image actually has ===');
  await run(sandbox, 'ffmpeg', 'command -v ffmpeg && ffmpeg -version 2>/dev/null | head -1');
  await run(sandbox, 'node', 'node -v');
  await run(sandbox, 'npm', 'npm -v');
  await run(sandbox, 'python3', 'python3 -V');
  await run(sandbox, 'hyperframes CLI on PATH', 'command -v hyperframes || echo "not on PATH"');
  await run(sandbox, 'npx hyperframes version', 'npx -y hyperframes@latest --version', 180_000);
  await run(sandbox, 'chrome headless shell', 'ls -d /home/user/.cache/hyperframes* /root/.cache/hyperframes* 2>/dev/null || echo "no browser cache"');
  await run(sandbox, 'any chromium binary', 'command -v chromium chromium-browser google-chrome 2>/dev/null || echo "none found"');
  await run(sandbox, 'the reel project', 'ls -la /home/user/nobogent_ai_reel 2>/dev/null || echo "project dir missing"');

  console.log('\n=== attempting the browser install (captures the real error) ===');
  await run(sandbox, 'hyperframes browser ensure', 'npx -y hyperframes@latest browser ensure', 240_000);
})();
