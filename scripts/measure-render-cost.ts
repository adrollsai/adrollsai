/**
 * Measures what a render actually costs, using the production code path.
 *
 * E2B bills per second of sandbox time, so the only honest unit is seconds:
 * sandbox-seconds x (vCPU rate + RAM rate). This script provisions a real
 * sandbox through getOrCreateSandbox(), renders the same 15s composition twice
 * with different flag sets, and reports seconds per variant plus the resulting
 * dollar cost. It also exercises pauseSandbox() so the idle-billing fix is
 * verified rather than assumed.
 *
 *   npm run measure:render
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getOrCreateSandbox, pauseSandbox, getSandboxCapabilities } from '../lib/agent/sandbox';
import { buildHyperFramesRenderScript, type RenderQuality } from '../lib/agent/tools/hyperframes-render';
import { Sandbox } from '@e2b/code-interpreter';

const key = (process.env.E2B_API_KEY || '').replace(/^["']|["']$/g, '').trim();

/** E2B list rates, USD per second (vCPU $0.0504/hr, RAM $0.0162/GiB/hr). */
const VCPU_PER_SEC = 0.000014;
const GIB_PER_SEC = 0.0000045;
/** Measured default sandbox, confirmed through Sandbox.getInfo(). */
const VCPU = 2;
const GIB = 2;
const IDLE_COST_PER_SEC = VCPU * VCPU_PER_SEC + GIB * GIB_PER_SEC;

const USER = 'cost-measure';
const PROJECT = 'costref';
const DURATION = 15;

interface Variant {
  label: string;
  fps: number;
  quality: RenderQuality;
}

const VARIANTS: Variant[] = [
  { label: 'current default (30fps, looks)', fps: 30, quality: 'looks' },
  { label: 'tuned (24fps, draft)', fps: 24, quality: 'draft' },
];

const results: { label: string; seconds: number; bytes: number; plan: string }[] = [];

function fmt(usd: number) {
  return `$${usd.toFixed(5)}`;
}

(async () => {
  const t0 = Date.now();
  const sandbox = await getOrCreateSandbox(USER);
  const provisionSeconds = (Date.now() - t0) / 1000;
  const caps = getSandboxCapabilities(USER);

  console.log('=== sandbox');
  console.log(`  provisioning          ${provisionSeconds.toFixed(1)}s  -> ${fmt(provisionSeconds * IDLE_COST_PER_SEC)}`);
  console.log(`  capabilities          ${JSON.stringify({ ffmpeg: caps?.ffmpeg, node: caps?.node, browsers: caps?.browsers })}`);
  const hw = await sandbox.commands.run('nproc; awk \'/MemTotal/{print int($2/1024)" MB"}\' /proc/meminfo', { timeoutMs: 20_000 });
  console.log(`  hardware              ${(hw.stdout || '').trim().replace(/\n/g, ' / ')}`);

  // Scaffold a known-good composition with the CLI itself, so the measurement
  // can never fail because of a hand-written fixture.
  console.log('\n=== scaffold');
  const scaffold = await sandbox.commands.run(
    [
      'export PATH=/usr/local/bin:$PATH',
      'HF=/home/user/.nobohf/node_modules/.bin/hyperframes',
      '[ -x "$HF" ] || HF="npx -y hyperframes@latest"',
      `rm -rf /home/user/${PROJECT}`,
      `cd /home/user && $HF init ${PROJECT} --skip-skills --skill=hyperframes 2>&1 | tail -20`,
      `cd /home/user/${PROJECT} && grep -o 'data-duration="[^"]*"' index.html | head -3`,
      `cd /home/user/${PROJECT} && grep -o 'data-fps="[^"]*"' index.html | head -3`,
    ].join('\n'),
    { timeoutMs: 300_000 }
  );
  console.log(`  exit=${scaffold.exitCode}`);
  console.log(((scaffold.stdout || '') + (scaffold.stderr || '')).trim().slice(0, 1200));

  if (scaffold.exitCode !== 0) {
    console.error('\nscaffold failed — no point continuing.');
    await pauseSandbox(USER);
    process.exit(1);
  }

  // Force the composition to the shape we actually sell: 15s vertical.
  const prep = await sandbox.commands.run(
    [
      `cd /home/user/${PROJECT}`,
      `sed -i 's/data-duration="[^"]*"/data-duration="${DURATION}"/g' index.html`,
      `sed -i 's/data-fps="[^"]*"/data-fps="30"/g' index.html`,
      `grep -o 'data-\\(duration\\|width\\|height\\|fps\\)="[^"]*"' index.html | head -6`,
      'ffmpeg -version | head -1',
    ].join('\n'),
    { timeoutMs: 60_000 }
  );
  console.log(`\n=== composition\n${(prep.stdout || '').trim()}`);

  for (const v of VARIANTS) {
    const script = buildHyperFramesRenderScript({
      projectDir: PROJECT,
      durationSeconds: DURATION,
      fps: v.fps,
      quality: v.quality,
    });
    console.log(`\n=== render: ${v.label}`);
    const started = Date.now();
    let out = '';
    try {
      const res = await sandbox.commands.run(script, { timeoutMs: 900_000 });
      out = (res.stdout || '') + (res.stderr || '');
    } catch (err: any) {
      out = String(err?.stdout || '') + String(err?.stderr || '') + String(err?.message || '');
    }
    const seconds = (Date.now() - started) / 1000;

    const plan = (/render-plan:.*/.exec(out) || [''])[0];
    const reported = Number((/render-seconds:\s*(\d+)/.exec(out) || [])[1] || 0);
    const size = Number((/render-seconds:[\s\S]*?\n.*?out\.mp4[\s\S]*?(\d{6,})/.exec(out) || [])[1] || 0);
    console.log(`  ${plan || '(no plan line)'}`);
    console.log(`  wall clock            ${seconds.toFixed(1)}s (CLI self-report ${reported || '?'}s)`);
    console.log(`  cost                  ${fmt(seconds * IDLE_COST_PER_SEC)}`);
    if (!/out\.mp4/.test(out) || !reported) {
      console.log(`  !! suspicious output:\n${out.slice(-1500)}`);
    }
    results.push({ label: v.label, seconds, bytes: size, plan });
  }

  await pauseSandbox(USER);
  // Must be checked through the API: the sandboxes are created with autoResume,
  // so running a probe command would wake the paused sandbox straight back up.
  const after = await Sandbox.getInfo(sandbox.sandboxId, { apiKey: key });
  const paused = `state=${after.state}`;

  console.log('\n=== summary');
  const base = results[0];
  for (const r of results) {
    const delta = base && r !== base ? ` ${((r.seconds / base.seconds - 1) * 100).toFixed(0)}% vs default` : '';
    console.log(`  ${r.label.padEnd(28)} ${r.seconds.toFixed(1).padStart(7)}s  ${fmt(r.seconds * IDLE_COST_PER_SEC)}${delta}`);
  }
  console.log(`  provisioning is ${provisionSeconds.toFixed(0)}s = ${fmt(provisionSeconds * IDLE_COST_PER_SEC)} of every cold run`);
  console.log(`  idle billing now paused: ${paused}`);

  const total = (provisionSeconds + results.reduce((s, r) => s + r.seconds, 0)) * IDLE_COST_PER_SEC;
  console.log(`  this session's sandbox cost: ${fmt(total)}`);
})().catch(async (err) => {
  console.error('measurement failed:', err?.message || err);
  try {
    await pauseSandbox(USER);
  } catch (e) {}
  process.exit(1);
});
