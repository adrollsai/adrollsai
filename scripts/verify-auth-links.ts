/**
 * Do the auth links actually land somewhere that exists?
 *
 * THE BUG THIS WOULD HAVE CAUGHT
 * The login page asked Supabase to put `next=/update-password` in every password-reset email. There is
 * no such page in this app — the reset form is `/auth/reset-password`. So the flow was: email arrives,
 * link clicked, token VERIFIED and spent, and only then a redirect to a 404. The user could not retry
 * with the same link, and the app looked broken rather than the route.
 *
 * Two kinds of assertion here, because the source-level one alone would not have caught it:
 *   - the destination rules (safeNext / isRecoveryTarget) behave, including for the dead path that old
 *     emails still carry;
 *   - EVERY literal auth destination in the app resolves to a page.tsx or route.ts ON DISK. That is the
 *     check that turns "the route was never built" from a production 404 into a failing gate.
 *
 *   npm run verify:auth-links
 *
 * Read-only: reads source, writes nothing, touches no network.
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_NEXT,
  RECOVERY_PATH,
  isRecoveryTarget,
  resolveRedirectTarget,
  safeNext,
} from '../lib/auth/redirects';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? `  — ${detail}` : ''}`);
  }
};

const read = (p: string) => fs.readFileSync(p, 'utf8');

// ── 1. does a destination exist on disk?
console.log('\n▸ every auth destination is a real page or route');
const existsAsPage = (routePath: string) => {
  const clean = routePath.split('?')[0].replace(/\/+$/, '') || '/';
  const rel = clean === '/' ? 'app/page.tsx' : `app${clean}/page.tsx`;
  return fs.existsSync(rel);
};
const existsAsRoute = (routePath: string) => {
  const clean = routePath.split('?')[0].replace(/\/+$/, '') || '/';
  const rel = `app${clean}/route.ts`;
  return fs.existsSync(rel);
};

check(
  `the reset page the whole flow depends on exists (${RECOVERY_PATH})`,
  existsAsPage(RECOVERY_PATH),
  existsAsPage(RECOVERY_PATH) ? 'app/auth/reset-password/page.tsx' : 'MISSING - every reset link would 404',
);
check(
  'the dead destination really is dead (that is why it was a bug)',
  !existsAsPage('/update-password') && !existsAsPage('/auth/update-password'),
  'if someone builds it later, this gate must be revisited',
);
check(
  'the callback route exists',
  existsAsRoute('/auth/callback'),
);

// ── 2. the destination rules
console.log('\n▸ recovery always lands on the page that can set a password');
check(
  'type=recovery sends a missing next to the reset form',
  resolveRedirectTarget(null, 'recovery') === RECOVERY_PATH,
);
check(
  'type=recovery overrides even an unrelated next',
  resolveRedirectTarget('/dashboard/analytics', 'recovery') === RECOVERY_PATH,
  'the token is for a password, not for analytics',
);
check(
  'the dead path old emails carry is rewritten to the real page',
  resolveRedirectTarget('/update-password', null) === RECOVERY_PATH &&
    resolveRedirectTarget('/auth/update-password', null) === RECOVERY_PATH,
  'links already sitting in inboxes now work',
);
check(
  'the real path is stable under its own rule',
  resolveRedirectTarget(RECOVERY_PATH, null) === RECOVERY_PATH,
);
check(
  'an ordinary sign-in still goes where it asked',
  resolveRedirectTarget('/dashboard/analytics', null) === '/dashboard/analytics' &&
    resolveRedirectTarget('/dashboard/onboarding', null) === '/dashboard/onboarding',
);
check(
  'isRecoveryTarget is true for recovery and false for ordinary pages',
  isRecoveryTarget('/update-password', null) === true &&
    isRecoveryTarget('/auth/reset-password', null) === true &&
    isRecoveryTarget('/dashboard/analytics', null) === false &&
    isRecoveryTarget('/pricing', null) === false,
);

console.log('\n▸ next can never become an open redirect');
for (const hostile of ['//evil.com', 'https://evil.com', 'javascript:alert(1)', '/\\evil.com', 'evil.com', '']) {
  check(
    `"${hostile || '(empty)'}" is refused`,
    safeNext(hostile) === DEFAULT_NEXT,
    safeNext(hostile),
  );
}
check(
  'and a normal internal path survives untouched',
  safeNext('/dashboard/crm?tab=leads') === '/dashboard/crm?tab=leads',
);

// ── 3. every literal destination the auth code uses, resolved
console.log('\n▸ the login page, the callback and the API agree on one destination');
const login = read('app/login/page.tsx');
const forgotApi = read('app/api/auth/forgot-password/route.ts');
const callback = read('app/auth/callback/route.ts');

const destinations = new Set<string>();
for (const source of [login, forgotApi]) {
  for (const m of source.matchAll(/\/auth\/callback\?next=([^\s'"`]+)/g)) destinations.add(m[1]);
}
check(
  'the login page no longer sends reset links to a page that does not exist',
  !/next=\/update-password/.test(login),
  destinations.size ? [...destinations].join(', ') : '(no destinations found)',
);
check(
  'every destination the app asks for exists',
  [...destinations].every((d) => existsAsPage(d) || existsAsRoute(d)),
  [...destinations].filter((d) => !existsAsPage(d) && !existsAsRoute(d)).join(', ') || 'all good',
);
check(
  'the login page and the API route use the SAME destination',
  /next=\/auth\/reset-password/.test(login) && /next=\/auth\/reset-password/.test(forgotApi),
  'two entry points, one page',
);
check(
  'the callback maps through the shared rules rather than its own copy',
  /resolveRedirectTarget\(/.test(callback) && !/function safeNext/.test(callback),
  'one definition of where recovery goes',
);
check(
  'a spent token still lands on the reset page with an error, not a 404',
  /RECOVERY_PATH\}\?error=/.test(callback),
  'the user can request a fresh link from the same screen',
);
check(
  'the stale /update-password entry is gone from the app-path allowlist',
  // Comments stripped: the file now explains WHY that entry was removed, and the explanation must
  // neither satisfy nor fail the assertion about the array itself.
  !/'\/update-password'/.test(
    read('lib/routing/host.ts')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ')
  ),
  'it was there as if the page existed',
);

// ── 4. the page itself can finish the job
console.log('\n▸ the reset page handles what the callback hands it');
const resetPage = read('app/auth/reset-password/page.tsx');
check(
  'it exchanges a code when one arrives',
  /exchangeCodeForSession\(/.test(resetPage),
);
check(
  'it listens for PASSWORD_RECOVERY as well as a plain session',
  /PASSWORD_RECOVERY/.test(resetPage) && /getSession\(/.test(resetPage),
);
check(
  'it can actually set the new password',
  /updateUser\(\{\s*password/.test(resetPage),
);
check(
  'and it explains an expired or invalid link instead of failing silently',
  /invalid or has expired/i.test(resetPage),
);

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
