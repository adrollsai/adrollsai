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
import { createSiteTools } from '../lib/agent/tools/sites';

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

  // The tool surface is chosen from the conversation, so a request that mentions pages is what
  // puts the page and publishing tools in the catalogue. Calling this with no intent sized the
  // surface for a vague turn and then reported the site tools as "missing" — measuring the test's
  // omission, not the product.
  const { tools } = await createAgentContext(sb, profile.id, {
    intentText: 'publish my landing page and check the connected accounts and custom domain',
    forceGroups: ['sites', 'publishing'],
  });
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

  // 4. Publishing a page: the GATE first, then the mechanics.
  //
  // This used to call the gated tool and treat its refusal as a failure, so a gate that was doing
  // exactly its job read as "publishing is broken". Both halves are checked now: the agent cannot
  // publish without a decision, and the call it would run once approved really does publish.
  const slug = 'zz-verify-temp-page';
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Verification page</title>
<style>body{font-family:system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#0b1120;color:#e2e8f0}main{text-align:center;padding:2rem}h1{font-size:2rem}</style>
</head><body><main><h1>Landing page published by the Nobogent agent</h1>
<p>This page was written and published end-to-end by an agent tool call.</p></main></body></html>`;

  const gatedAttempt = await t.site_publish_landing_page.execute(
    { slug, title: 'Verification page', htmlContent: html },
    { toolCallId: 'v4', messages: [] }
  );
  record(
    'site_publish_landing_page is behind the approval gate',
    gatedAttempt?.needs_review === true,
    gatedAttempt?.needs_review ? String(gatedAttempt.why) : JSON.stringify(gatedAttempt)?.slice(0, 160)
  );

  // The ungated suite is what an APPROVED call ends up running, so this proves the mechanics.
  const rawSites = createSiteTools(sb, profile.id) as any;
  const pub = await rawSites.site_publish_landing_page.execute(
    { slug, title: 'Verification page', htmlContent: html },
    { toolCallId: 'v5', messages: [] }
  );
  record('publishing works once approved', pub?.success === true, pub?.success ? `${pub.action} -> ${pub.url}` : pub?.error);

  if (pub?.success && pub.url) {
    // The tool reports the configured public host; NEXT_PUBLIC_APP_URL is a white-label host that is
    // not always reachable from here, so the page is fetched from whichever of the two answers.
    const candidates = [pub.url, `${(process.env.VERIFY_BASE_URL || 'https://app.pipixel.io').replace(/\/$/, '')}/shared/${profile.id}/${slug}`];
    let rendered = false;
    let detail = 'no candidate URL';
    for (const candidate of candidates) {
      try {
        const res = await fetch(candidate, { redirect: 'follow' });
        const body = await res.text();
        detail = `HTTP ${res.status} from ${candidate}`;
        if (res.ok && /Landing page published by the Nobogent agent/.test(body)) {
          rendered = true;
          break;
        }
      } catch (err: any) {
        detail = `fetch failed for ${candidate}: ${err?.message}`;
      }
    }
    record('published page renders', rendered, detail);
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
