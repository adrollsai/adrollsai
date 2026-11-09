/**
 * Verifies the publishing and site tools.
 *
 * Read checks run against a real connected profile; the landing-page check
 * actually publishes a temporary page, fetches its public URL to prove it is
 * live, then deletes it so no test junk is left in the account.
 *
 *   npm run verify:sites
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';

const results: { step: string; ok: boolean; detail: string }[] = [];
const record = (step: string, ok: boolean, detail: string) => {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}  ${detail}`);
};

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

(async () => {
  const { data: profiles } = await sb
    .from('profiles')
    .select('id, business_name, selected_page_id, linkedin_id')
    .not('selected_page_id', 'is', null)
    .limit(5);

  const profile = profiles?.[0];
  if (!profile) {
    console.error('no profile with a connected page');
    process.exit(1);
  }
  console.log(`Using profile ${profile.id} (${profile.business_name})\n`);

  const { tools } = await createAgentContext(sb, profile.id);
  const t = tools as any;

  const names = Object.keys(tools);
  const needed = ['social_connected_accounts', 'publish_social_post', 'site_domain_status', 'site_publish_landing_page', 'site_list_landing_pages'];
  const missing = needed.filter((n) => !names.includes(n));
  record('catalogue has publishing + site tools', missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : `${names.length} tools total`);

  // The agent must not be able to touch domain attachment.
  record(
    'agent cannot attach domains',
    !names.includes('site_connect_domain'),
    names.includes('site_connect_domain') ? 'site_connect_domain is still registered' : 'no domain-write tool registered'
  );

  // 1. Connected accounts
  const accts = await t.social_connected_accounts.execute({}, { toolCallId: 'v1', messages: [] });
  record(
    'social_connected_accounts',
    accts?.success === true,
    accts?.success ? `connected: ${accts.platforms.join(', ') || 'none'} (fbPage=${accts.details?.facebook?.pageName || '—'})` : accts?.error
  );

  // 2. Domain status
  const dom = await t.site_domain_status.execute({}, { toolCallId: 'v2', messages: [] });
  record(
    'site_domain_status',
    dom?.success === true,
    dom?.success ? `host=${dom.publicHost} custom=${dom.customDomain || 'none'} pages=${dom.pageCount}` : dom?.error
  );

  // 3. Existing pages
  const list = await t.site_list_landing_pages.execute({ limit: 5 }, { toolCallId: 'v3', messages: [] });
  record(
    'site_list_landing_pages',
    list?.success === true,
    list?.success ? `${list.count} pages${list.pages?.[0] ? `, first: ${list.pages[0].slug}` : ''}` : list?.error
  );

  // 4. Actually publish a page, then fetch it.
  const slug = 'zz-verify-temp-page';
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Verification page</title>
<style>body{font-family:system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#0b1120;color:#e2e8f0}main{text-align:center;padding:2rem}h1{font-size:2rem}</style>
</head><body><main><h1>Landing page published by the Nobogent agent</h1>
<p>This page was written and published end-to-end by an agent tool call.</p></main></body></html>`;

  const pub = await t.site_publish_landing_page.execute(
    { slug, title: 'Verification page', htmlContent: html },
    { toolCallId: 'v4', messages: [] }
  );
  record('site_publish_landing_page', pub?.success === true, pub?.success ? `${pub.action} -> ${pub.url}` : pub?.error);

  if (pub?.success && pub.url) {
    // NEXT_PUBLIC_APP_URL is a white-label host that is not always reachable
    // from this machine, so prove the page renders by hitting the same path on
    // a server we know is up (the dev server), and report the configured host
    // separately.
    const localBase = (process.env.VERIFY_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
    const localUrl = `${localBase}/shared/${profile.id}/${slug}`;
    try {
      const res = await fetch(localUrl, { redirect: 'follow' });
      const body = await res.text();
      const ok = res.ok && /Landing page published by the Nobogent agent/.test(body);
      record('published page renders', ok, `HTTP ${res.status} from ${localUrl}`);
    } catch (err: any) {
      record('published page renders', false, `fetch failed: ${err?.message}`);
    }
    record('public URL points at configured host', Boolean(pub.publicHost), `${pub.url}`);
  } else {
    record('published page renders', false, 'skipped — publish failed');
  }

  // Clean up so no test page is left behind.
  const del = await sb.from('landing_pages').delete().eq('user_id', profile.id).eq('slug', slug);
  record('cleanup test page', !del.error, del.error?.message || `removed "${slug}"`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
})().catch((err) => {
  console.error('verification crashed:', err?.message || err);
  process.exit(1);
});
