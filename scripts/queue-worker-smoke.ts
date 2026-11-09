// Queue one small run for the standalone worker smoke test.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { createSession, appendEvents } from '../lib/agent/harness/store';
import { createEvent } from '../lib/agent/harness/events';
import { enqueueRun } from '../lib/agent/harness/runs';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

(async () => {
  const { data: profiles } = await admin.from('profiles').select('id').limit(1);
  const userId = profiles![0].id as string;

  const session = await createSession(admin, userId, { title: 'worker smoke', workspaceId: '__worker_smoke__' });
  if (!session) throw new Error('session failed');

  await appendEvents(admin, session.id, [
    createEvent('user.message', {
      id: `u_${Date.now()}`,
      text: 'Reply with exactly WORKER_OK and nothing else. Use no tools.',
    }),
  ]);

  const run = await enqueueRun(admin, { sessionId: session.id, userId, goal: 'worker smoke' });
  console.log(JSON.stringify({ sessionId: session.id, runId: run?.id }));
})();
