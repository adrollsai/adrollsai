/**
 * Reports the live state of every sandbox this project has cached, so the
 * pause-on-idle fix is verified from the API rather than inferred.
 *
 * Running a command is NOT a valid check: sandboxes are created with
 * autoResume, so the probe itself wakes a paused sandbox back up.
 *
 *   npm run check:sandboxes
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { Sandbox } from '@e2b/code-interpreter';
import fs from 'node:fs';

const key = (process.env.E2B_API_KEY || '').replace(/^["']|["']$/g, '').trim();

(async () => {
  const cached: Record<string, { sandboxId: string; lastUsed: number }> = fs.existsSync(
    '.nobogent/e2b_sandboxes.json'
  )
    ? JSON.parse(fs.readFileSync('.nobogent/e2b_sandboxes.json', 'utf8'))
    : {};

  console.log('=== cached sandboxes');
  for (const [userId, entry] of Object.entries(cached)) {
    try {
      const info = await Sandbox.getInfo(entry.sandboxId, { apiKey: key });
      const ageMin = ((Date.now() - entry.lastUsed) / 60000).toFixed(1);
      console.log(
        `  ${userId.padEnd(22)} ${entry.sandboxId}  state=${info.state.padEnd(8)} ` +
          `${info.cpuCount}cpu/${Math.round(info.memoryMB)}MB  lastUsed=${ageMin}min ago`
      );
    } catch (err: any) {
      console.log(`  ${userId.padEnd(22)} ${entry.sandboxId}  gone (${String(err?.message || err).slice(0, 60)})`);
    }
  }

  console.log('\n=== all project sandboxes (running ones bill money right now)');
  try {
    const lines: string[] = [];
    const paginator = Sandbox.list({ apiKey: key });
    while (paginator.hasNext) {
      const page = await paginator.nextItems({ apiKey: key });
      for (const sbx of page) {
        lines.push(`  ${sbx.sandboxId}  ${sbx.state.padEnd(8)} ${sbx.cpuCount}cpu/${Math.round(sbx.memoryMB)}MB`);
      }
    }
    console.log(lines.length ? lines.join('\n') : '  none');
  } catch (err: any) {
    console.log(`  list failed: ${String(err?.message || err).slice(0, 120)}`);
  }

  // `--pause <userId>` stops a cached sandbox from billing. Verified afterwards
  // through getInfo(), because a command probe would auto-resume it.
  const pauseIdx = process.argv.indexOf('--pause');
  if (pauseIdx !== -1) {
    const userId = process.argv[pauseIdx + 1];
    const entry = cached[userId];
    if (!entry) {
      console.log(`\nno cached sandbox for "${userId}"`);
      return;
    }
    await Sandbox.pause(entry.sandboxId, { apiKey: key });
    const after = await Sandbox.getInfo(entry.sandboxId, { apiKey: key });
    console.log(`\npaused ${userId} (${entry.sandboxId}) -> state=${after.state}`);
  }
})();
