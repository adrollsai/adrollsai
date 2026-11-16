/**
 * Where will a landing page actually live — and is the URL the agent gives the owner real?
 *
 * §3.7: "landing pages attached to the user's own domain from profile". The pieces exist
 * (`site_domain_status` reads profiles.whitelabel_domain/custom_domain; the shared route resolves a
 * tenant by custom_domain when the identifier contains a dot, by id otherwise), but nothing proved
 * they agree. A URL the agent reads off a tool and hands to the owner is exactly the kind of claim
 * that must be clickable, or it is worse than no URL at all.
 *
 * Checks, without publishing anything:
 *   1. site_domain_status reports the SAME domain the profile row holds;
 *   2. its urlPattern is one the shared route can actually resolve;
 *   3. /shared is excluded from the middleware matcher, so the pattern is not rewritten underneath
 *      the customer's domain (a double prefix is how a "correct" URL 404s);
 *   4. a custom-domain host with a bare /<slug> routes to /shared/<host>/<slug>, and that identifier
 *      contains a dot so the shared route matches it against custom_domain.
 *
 *   npx esbuild scripts/verify-site-domain.ts --bundle --platform=node --format=esm \
 *     --packages=external --outfile=.tmp-site-domain.mjs && node .tmp-site-domain.mjs
 */
import fs from 'node:fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';
import { decideRouting } from '../lib/routing/host';

dotenv.config({ path: '.env.local', quiet: true });

const ORG = '9c0748de-e3da-4ea1-b323-4ce736b5ca7c';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
};

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

const profile = await sb
  .from('profiles')
  .select('id, business_name, custom_domain, whitelabel_domain')
  .eq('id', ORG)
  .maybeSingle();
const p: any = profile.data;
console.log(`org: ${p?.business_name}`);
console.log(`custom_domain: ${p?.custom_domain ?? '(none)'}`);
console.log(`whitelabel_domain: ${p?.whitelabel_domain ?? '(none)'}\n`);

const ctx = await createAgentContext(sb as any, ORG, {
  intentText: 'where will my landing page live, and what is my domain?',
});
const tool = (ctx.tools as any).site_domain_status;
check('site_domain_status is available on a domain question', Boolean(tool?.execute));
check('the sites group is loaded for it', ctx.toolGroups.includes('sites'), ctx.toolGroups.join(','));

if (tool?.execute) {
  const result = await tool.execute({}, {} as any);
  console.log(`tool result: ${JSON.stringify(result)}\n`);
  check('the tool succeeds', result?.success === true, String(result?.error ?? ''));

  const expectedDomain = String(p?.whitelabel_domain || p?.custom_domain || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  check(
    'it reports the same domain the profile holds',
    String(result?.customDomain ?? '') === expectedDomain,
    `tool="${result?.customDomain}" profile="${expectedDomain}"`,
  );

  // ── THE INVARIANT THAT MATTERS. A configured domain is a claim; only a domain that actually
  // answers for us may be presented to the owner as where their page lives.
  const check_ = result?.domainCheck;
  check('it actually checks the configured domain', check_ !== null && typeof check_ === 'object', JSON.stringify(check_));
  check(
    'onCustomDomain is never true for a domain verified as NOT ours',
    !(check_?.servesNobogent === false) || result?.onCustomDomain === false,
    `servesNobogent=${check_?.servesNobogent} onCustomDomain=${result?.onCustomDomain}`,
  );
  if (check_?.servesNobogent === false) {
    check(
      'a domain that is not ours is not used for the advertised URL',
      !String(result?.urlPattern ?? '').includes(expectedDomain),
      `${result?.urlPattern} (server: ${check_?.server}, ${check_?.detail})`,
    );
    check(
      'it still hands over a URL that works',
      /^https:\/\//.test(String(result?.guaranteedUrlPattern ?? '')) &&
        !String(result?.guaranteedUrlPattern ?? '').includes(expectedDomain),
      String(result?.guaranteedUrlPattern),
    );
    check(
      'the note tells the owner the custom domain is not serving pages',
      /not currently serving these pages/i.test(String(result?.note ?? '')),
      String(result?.note ?? '').slice(0, 110),
    );
  } else {
    check(
      'a domain that IS ours is used for the advertised URL',
      String(result?.urlPattern ?? '').includes(expectedDomain) ||
        check_?.servesNobogent === null,
      `${result?.urlPattern}`,
    );
    check(
      'when no domain is attached, it points at dashboard Settings instead of inventing one',
      Boolean(expectedDomain) || /dashboard Settings/i.test(String(result?.note ?? '')),
      String(result?.note ?? '').slice(0, 90),
    );
  }

  // ── The routing half: the pattern must survive the real routing decisions.
  const middleware = fs.readFileSync('middleware.ts', 'utf8');
  check(
    '/shared is excluded from the middleware matcher',
    /\(\?!api\|_next\/static\|_next\/image\|auth\|shared\|/.test(middleware),
    'otherwise a custom domain rewrites the shared path and double-prefixes it',
  );

  if (expectedDomain) {
    const bare = decideRouting({ host: expectedDomain, pathname: '/november-batch' });
    check(
      'a bare slug on the custom domain rewrites into /shared/<host>/<slug>',
      bare.kind === 'storefront' && bare.rewriteTo === `/shared/${expectedDomain}/november-batch`,
      JSON.stringify(bare),
    );
    check(
      'that rewritten identifier contains a dot, so the shared route matches custom_domain',
      expectedDomain.includes('.'),
      expectedDomain,
    );
  } else {
    console.log('(no custom domain attached — skipping the storefront rewrite checks)');
  }

  const appPath = decideRouting({ host: expectedDomain || 'someone.example.com', pathname: '/dashboard' });
  check(
    'a customer domain can never swallow an app path',
    appPath.kind === 'app',
    JSON.stringify(appPath),
  );
}

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
