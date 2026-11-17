/**
 * End-to-end proof that a brand-new signup meets the paywall.
 *
 * Creates a disposable account with no subscription and no role, signs it in for real, and asks production for
 * /dashboard the way a browser would. A new signup must be redirected to the paywall; it must not be handed the
 * dashboard.
 *
 * Everything it creates is deleted at the end, including the profile row the signup trigger writes.
 *
 *   npx tsx scripts/probe-paywall-e2e.mts
 */
import '../lib/env-local';
import { createClient } from '@supabase/supabase-js';

const APP = process.argv[2] || 'https://app.nobogent.com';
const EMAIL = `paywall-probe-${Date.now()}@nobogent.com`;
const PASSWORD = `Probe-${Math.random().toString(36).slice(2)}-A1!`;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ref = new URL(url).hostname.split('.')[0];

const admin = createClient(url, service, { auth: { persistSession: false } });

function cookieValue(session: any): string {
  const json = JSON.stringify(session);
  return `base64-${Buffer.from(json, 'utf8').toString('base64url')}`;
}

/** @supabase/ssr chunks large session cookies as name.0, name.1 ... */
function cookiesFor(session: any): string {
  const name = `sb-${ref}-auth-token`;
  const value = cookieValue(session);
  const CHUNK = 3180;
  if (value.length <= CHUNK) return `${name}=${value}`;
  const parts: string[] = [];
  for (let i = 0; i * CHUNK < value.length; i++) {
    parts.push(`${name}.${i}=${value.slice(i * CHUNK, (i + 1) * CHUNK)}`);
  }
  return parts.join('; ');
}

async function request(path: string, cookie: string) {
  const res = await fetch(`${APP}${path}`, {
    headers: { cookie },
    redirect: 'manual',
  });
  return { status: res.status, location: res.headers.get('location'), body: await res.text() };
}

let createdId: string | null = null;
let ok = true;
const say = (name: string, pass: boolean, detail = '') => {
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

try {
  // 1. A real signup shape: confirmed email, no role, no subscription, no parent.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (createErr || !created?.user) throw new Error(`could not create probe user: ${createErr?.message}`);
  createdId = created.user.id;
  console.log(`probe user ${EMAIL} (${createdId})`);

  const { data: profile } = await admin
    .from('profiles')
    .select('role, parent_id, agency_id, subscription_status, subscription_valid_until')
    .eq('id', createdId)
    .maybeSingle();
  console.log('probe profile:', JSON.stringify(profile));
  say('the signup trigger creates a profile row', Boolean(profile), profile ? '' : 'no row — the gate cannot decide without one');

  // 2. Sign in for real, exactly as the login form does.
  const userClient = createClient(url, anon, { auth: { persistSession: false } });
  const { data: signIn, error: signInErr } = await userClient.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (signInErr || !signIn?.session) throw new Error(`probe could not sign in: ${signInErr?.message}`);
  console.log('signed in, session issued');

  const cookie = cookiesFor(signIn.session);

  // 3. Ask production for the dashboard the way a browser would.
  const dashboard = await request('/dashboard', cookie);
  const loc = dashboard.location || '';
  say(
    'a new signup is sent to the paywall, not the dashboard',
    dashboard.status === 307 || dashboard.status === 308 ? /\/dashboard\/onboarding/.test(loc) : false,
    `${dashboard.status} -> ${loc || '(no redirect)'}`,
  );
  say(
    'the dashboard itself is not served',
    !/DashboardLayout|QuotaManager/.test(dashboard.body) || dashboard.status >= 300,
    `body ${dashboard.body.length} bytes`,
  );

  // 4. The paywall page must still be reachable, or the redirect is a dead end.
  const onboarding = await request('/dashboard/onboarding', cookie);
  say(
    'the paywall page is reachable for that account',
    onboarding.status === 200,
    `status ${onboarding.status}`,
  );

  // 5. A deep route must be gated too, not just the root.
  const crm = await request('/dashboard/crm', cookie);
  say(
    'a deep dashboard route is gated as well',
    crm.status === 307 || crm.status === 308,
    `${crm.status} -> ${crm.location || '(no redirect)'}`,
  );
} catch (err: any) {
  ok = false;
  console.log(`FAIL  probe could not complete — ${err?.message}`);
} finally {
  if (createdId) {
    await admin.from('profiles').delete().eq('id', createdId);
    const { error } = await admin.auth.admin.deleteUser(createdId);
    console.log(error ? `probe user cleanup: ${error.message}` : 'probe user deleted');
  }
  console.log(ok ? '\nALL CHECKS PASSED' : '\nSOME CHECKS FAILED');
  if (!ok) process.exitCode = 1;
}
