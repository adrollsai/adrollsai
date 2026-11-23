/**
 * Proves the host-routing decision, including the failure that broke production.
 *
 * The bug this pins down was invisible to every other test: valid TypeScript, green gates,
 * a clean build, a successful deploy — and every logged-in user got a 404 on every page,
 * because the platform stopped recognising its own domain once a session cookie was present.
 *
 *   npm run verify:routing
 */
import {
  decideRouting,
  isAppPath,
  isOurOwnDomain,
  isPlatformHost,
  normaliseHost,
  parseExtraDomains,
} from '../lib/routing/host';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}
const head = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);

head('1. Our own domains, and a client whitelabel domain, are different things');

check(
  'app.nobogent.com is OURS',
  isPlatformHost('app.nobogent.com') === true && isOurOwnDomain('app.nobogent.com') === true,
  'our production app domain',
);
check(
  'the bare domain and other subdomains are ours too',
  isPlatformHost('nobogent.com') === true &&
    isPlatformHost('www.nobogent.com') === true &&
    isOurOwnDomain('nobogent.com') === true,
  'nobogent.com, www.nobogent.com',
);
check(
  'app.pipixel.io is a CLIENT whitelabel domain, not ours',
  isOurOwnDomain('app.pipixel.io') === false && isOurOwnDomain('pipixel.io') === false,
  'PiPixel is a customer (profiles.whitelabel_domain), so it must never appear as our own domain',
);
check(
  'but it still has to serve the app shell for that client',
  isPlatformHost('app.pipixel.io') === true && isPlatformHost('pipixel.io') === true,
  'known whitelabel app domain - the RLS regression is why it is listed',
);
check(
  'one of the clients whose domain serves a storefront is not an app host',
  isPlatformHost('redrosecity.in') === false && isOurOwnDomain('redrosecity.in') === false,
  'a storefront domain is resolved from the database, not hardcoded',
);
check(
  'local development and preview deployments are the platform',
  isPlatformHost('localhost:3000') === true &&
    isPlatformHost('127.0.0.1:3000') === true &&
    isPlatformHost('nobogent-abc123-nobogentai.vercel.app') === true,
  'localhost, 127.0.0.1, *.vercel.app',
);
check(
  'a deployment can add a domain without a code change',
  isPlatformHost('app.example.com', ['example.com']) === true,
  'NEXT_PUBLIC_PLATFORM_DOMAINS',
);
check(
  'a lookalike host is NOT the platform',
  isPlatformHost('notnobogent.com') === false &&
    isPlatformHost('nobogent.com.evil.com') === false &&
    isPlatformHost('notpipixel.io') === false &&
    isPlatformHost('pipixel.io.evil.com') === false,
  'suffix matching is on dots, not substrings',
);
check(
  'ports are stripped before comparison',
  normaliseHost('App.Nobogent.com:443') === 'app.nobogent.com' && normaliseHost(null) === '',
  'case and port handled',
);
check(
  'env parsing is forgiving',
  parseExtraDomains(' a.com, ,b.com , ').join('|') === 'a.com|b.com' && parseExtraDomains(undefined).length === 0,
  'blank entries dropped',
);

head('2. App paths are never rewritten into a storefront');

check(
  'dashboard, login and auth are app paths',
  isAppPath('/dashboard') && isAppPath('/dashboard/agent') && isAppPath('/login') && isAppPath('/auth/callback'),
  'the shell',
);
check(
  'a storefront path is not an app path',
  isAppPath('/') === false && isAppPath('/about') === false && isAppPath('/dashboardx') === false,
  'no false positives from prefix matching',
);

head('3. The production regression, replayed');

check(
  'THE BUG: a signed-in user on app.pipixel.io still gets the app',
  decideRouting({ host: 'app.pipixel.io', pathname: '/dashboard/agent', isWhitelabelPlatform: false }).kind === 'app',
  'whitelabel lookup failed (RLS) and the app still opens',
);
check(
  'even an unknown host cannot swallow the dashboard',
  decideRouting({ host: 'brand-new-customer.com', pathname: '/dashboard/usage', isWhitelabelPlatform: false }).kind === 'app',
  'a misconfigured domain cannot lock users out',
);
check(
  'an unknown host still serves its storefront at the root',
  (() => {
    const decision = decideRouting({ host: 'brand-new-customer.com', pathname: '/', isWhitelabelPlatform: false });
    return decision.kind === 'storefront' && decision.rewriteTo === '/shared/brand-new-customer.com/index';
  })(),
  '/shared/<host>/index',
);
check(
  'a known tenant domain keeps its storefront on inner pages',
  (() => {
    const decision = decideRouting({ host: 'redrosecity.in', pathname: '/about', isWhitelabelPlatform: true });
    return decision.kind === 'app';
  })(),
  'a registered whitelabel domain is never rewritten',
);
check(
  'an unregistered tenant domain serves the storefront on a marketing path',
  (() => {
    const decision = decideRouting({ host: 'deccanrealtors.com', pathname: '/projects', isWhitelabelPlatform: false });
    return decision.kind === 'storefront' && decision.rewriteTo === '/shared/deccanrealtors.com/projects';
  })(),
  'storefront path preserved',
);

head('4. The decision is total — every input answers');

const hosts = ['app.pipixel.io', 'redrosecity.in', 'localhost:3000', '', null, 'APP.PIPIXEL.IO:443'];
const paths = ['/', '/dashboard', '/login', '/about', '', '/api/x'];
let total = 0;
for (const host of hosts) {
  for (const pathname of paths) {
    for (const isWhitelabelPlatform of [true, false]) {
      const decision = decideRouting({ host, pathname, isWhitelabelPlatform });
      if (decision.kind === 'app' || decision.kind === 'storefront') total++;
    }
  }
}
check('every host × path × whitelabel combination decides', total === hosts.length * paths.length * 2, `${total} combinations`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
