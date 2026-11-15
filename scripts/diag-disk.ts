/** What disk does the sandbox actually have, and can /tmp be made bigger? */
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
  intentText: 'disk layout',
});
const tools = ctx.tools as any;

const res: any = await tools.sandbox_bash_run.execute({
  command: [
    'echo "=== df -h ==="; df -h 2>/dev/null',
    'echo "=== whoami / sudo ==="; whoami; sudo -n true 2>&1 && echo "sudo ok" || echo "no passwordless sudo"',
    'echo "=== mounts of interest ==="; mount | grep -E " /tmp | / |/home" | head -10',
    'echo "=== big dirs ==="; du -sh /home/user/.npm /home/user/.cache /usr 2>/dev/null | sort -h | tail -5',
  ].join('\n'),
});
console.log(String(res.stdout || '').slice(0, 3000));
console.log('stderr:', String(res.stderr || '').slice(0, 500));
