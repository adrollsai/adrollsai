/**
 * Find out why `hyperframes render` exits 1 inside the sandbox.
 *
 * The tool reports only "exit status 1". This writes a minimal composition with the correct
 * write-file shape, runs the CLI by hand, and prints the CLI's own output — including `check`,
 * which is HyperFrames' own preflight and the thing that names a composition problem.
 */
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
const OWNER = 'bc63c065-9bcc-4793-bedc-f0960406425b';

const HTML = `<!doctype html>
<html>
<head><meta charset="utf-8" />
<style>
 html,body{margin:0;background:#0F172A;font-family:Arial,sans-serif}
 #stage{position:relative;width:1080px;height:1920px;overflow:hidden}
 h1{position:absolute;top:820px;left:0;right:0;text-align:center;color:#fff;font-size:96px;margin:0}
</style></head>
<body>
 <div id="stage" data-dur="4" data-fps="30">
   <h1 id="t">HELLO</h1>
 </div>
</body>
</html>`;

const ctx = await createAgentContext(admin, OWNER, { intentText: 'diagnose hyperframes render' });
const tools = ctx.tools as any;

const write = await tools.sandbox_write_file.execute({ path: 'hf_diag/index.html', content: HTML });
console.log('write:', JSON.stringify(write).slice(0, 220));

const script = [
  'export PATH=/usr/local/bin:$PATH',
  'cd /home/user/hf_diag || exit 9',
  'ls -la',
  'HF=/home/user/.nobohf/node_modules/.bin/hyperframes',
  'if [ ! -x "$HF" ]; then echo "(installing CLI)"; cd /home/user/.nobohf && npm init -y >/dev/null 2>&1 && npm install hyperframes --no-audit --no-fund >/tmp/inst.log 2>&1; cd /home/user/hf_diag; fi',
  '[ -x "$HF" ] || HF="npx -y hyperframes"',
  'echo "=== version ==="; $HF --version 2>&1 | head -2',
  'echo "=== check ==="; $HF check 2>&1 | tail -25',
  'echo "=== render ==="; $HF render --output out.mp4 --quality draft >/tmp/r.log 2>&1; echo "exit=$?"; tail -30 /tmp/r.log',
  'echo "=== files ==="; ls -la; ls -la out.mp4 2>/dev/null',
].join('\n');

const res = await tools.sandbox_bash_run.execute({ command: script });
const text = JSON.stringify(res);
fs.writeFileSync('.tmp-hf-diag2.json', text);
const parsed = res as any;
console.log('\n--- stdout ---\n' + String(parsed.stdout || '').slice(0, 4000));
console.log('\n--- stderr ---\n' + String(parsed.stderr || '').slice(0, 1500));
