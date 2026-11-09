// Confirm the live verification left nothing behind — uses the service role so
// RLS cannot hide rows from the check.
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env.local', 'utf8');
const get = (n) => {
  const m = env.match(new RegExp('^' + n + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
};

const admin = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});

const sessions = await admin.from('harness_sessions').select('id, workspace_id', { count: 'exact' });
const events = await admin.from('harness_events').select('id', { count: 'exact', head: true });
const workspaces = await admin.from('harness_workspaces').select('id, name', { count: 'exact' });

console.log('harness_sessions   count=' + (sessions.count ?? '?') + ' rows=' + JSON.stringify(sessions.data));
console.log('harness_events     count=' + (events.count ?? '?'));
console.log('harness_workspaces count=' + (workspaces.count ?? '?') + ' rows=' + JSON.stringify(workspaces.data));
