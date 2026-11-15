/**
 * Run the production render script by hand and print everything it says.
 * The tool returns only "exit status 1"; the script's own log is where the reason lives.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';
import { buildHyperFramesRenderScript } from '../lib/agent/tools/hyperframes-render';

dotenv.config({ path: '.env.local', quiet: true });
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const ctx = await createAgentContext(admin, 'bc63c065-9bcc-4793-bedc-f0960406425b', {
  intentText: 'manual render',
});
const tools = ctx.tools as any;

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

await tools.sandbox_write_file.execute({ path: 'hf_manual/index.html', content: HTML });

const script = buildHyperFramesRenderScript({
  projectDir: 'hf_manual',
  durationSeconds: 4,
  quality: 'draft',
});

const res: any = await tools.sandbox_bash_run.execute({ command: script });
console.log('exitCode:', res?.exitCode, 'success:', res?.success);
console.log('\n--- stdout ---\n' + String(res?.stdout || '').slice(-3500));
console.log('\n--- stderr ---\n' + String(res?.stderr || '').slice(-1500));
