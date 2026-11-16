/** Repair a sandbox my /tmp bind-mount left half-broken, then re-provision and render. */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';

dotenv.config({ path: '.env.local', quiet: true });
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const ctx = await createAgentContext(admin, 'bc63c065-9bcc-4793-bedc-f0960406425b', {
  intentText: 'repair sandbox',
});
const tools = ctx.tools as any;

const res: any = await tools.sandbox_bash_run.execute({
  command: [
    'echo "=== before ==="; df -h /tmp; ls -ld /tmp',
    'sudo -n umount /tmp 2>/dev/null && echo "unmounted our bind" || echo "nothing to unmount"',
    'sudo -n chmod 1777 /tmp 2>/dev/null; sudo -n mount -t tmpfs -o size=992M tmpfs /tmp 2>/dev/null || true',
    'echo "=== after ==="; df -h /tmp; ls -ld /tmp',
    'echo "=== apt sanity ==="; sudo -n apt-get install -y --reinstall libnss3 >/tmp/apt.log 2>&1; echo "apt exit=$?"; tail -3 /tmp/apt.log',
  ].join('\n'),
});
console.log('exit:', res?.exitCode);
console.log(String(res?.stdout || '').slice(0, 2000));
console.log('stderr:', String(res?.stderr || '').slice(0, 600));
