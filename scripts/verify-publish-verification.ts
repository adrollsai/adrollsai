/**
 * "Live" has to be something we can click.
 *
 * site_publish_landing_page used to answer "Landing page X created and live at <url>" purely because
 * the row was written and the URL was composed. With a custom domain pointing elsewhere, that
 * sentence was false and the owner got a 404. It now fetches the page it just wrote and reports
 * `verified`, and says SAVED rather than LIVE when it cannot confirm.
 *
 * This exercises the whole path for real: the review gate refuses, the approval is recorded with the
 * tool's exact arguments, the approval is granted the way the UI grants it, the retry publishes, and
 * the returned URL is fetched here independently. It then DELETES the test page and its approval
 * rows, so running this leaves the owner's site exactly as it found it.
 *
 *   npx esbuild scripts/verify-publish-verification.ts --bundle --platform=node --format=esm \
 *     --packages=external --outfile=.tmp-publish.mjs && node .tmp-publish.mjs
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createAgentContext } from '../lib/agent/orchestrator';

dotenv.config({ path: '.env.local', quiet: true });

const ORG = '9c0748de-e3da-4ea1-b323-4ce736b5ca7c';
const SLUG = 'agent-proof-do-not-index';

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

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent publish verification</title>
<style>body{font-family:system-ui,sans-serif;background:#0F172A;color:#fff;padding:48px;line-height:1.6}</style>
</head><body>
<h1>Publish verification page</h1>
<p>This page exists only to prove that a publish is confirmed by fetching it. It is deleted by the
script that created it.</p>
<p>Procolor Film Academy — Diploma in Cinematography.</p>
<p>Call 9569919985.</p>
</body></html>`;

const args = { slug: SLUG, title: 'Agent publish verification', htmlContent: html };

let approvalRowId: string | null = null;

try {
  const ctx = await createAgentContext(sb as any, ORG, { intentText: 'publish a landing page' });
  const tool = (ctx.tools as any).site_publish_landing_page;
  check('site_publish_landing_page is registered for a publish request', Boolean(tool?.execute));

  // 1. Unapproved: must refuse, because a page is public the moment it exists.
  const refused = await tool.execute(args, {} as any);
  check('the publish is refused without approval', refused?.needs_review === true, String(refused?.actionType));
  const actionId = String(refused?.actionId ?? '');
  check('the refusal carries an actionId', Boolean(actionId), actionId);

  // 2. Approve it the way the UI tap does.
  if (actionId) {
    const row = await sb
      .from('agent_events')
      .select('id, payload')
      .eq('user_id', ORG)
      .eq('event_type', 'PENDING_ACTION_APPROVAL')
      .eq('payload->>actionId', actionId)
      .maybeSingle();
    approvalRowId = (row.data as any)?.id ?? null;
    const recorded = (row.data as any)?.payload?.actionPayload ?? {};
    check(
      'the card holds the tool arguments, not a summary',
      recorded.slug === SLUG && typeof recorded.htmlContent === 'string',
      JSON.stringify(recorded).slice(0, 120),
    );
    await sb.from('agent_events').update({ status: 'approved' }).eq('id', approvalRowId);
  }

  // 3. Retry with the approvalId AND the same arguments — the only shape the schema accepts.
  const published = await tool.execute({ ...args, approvalId: actionId }, {} as any);
  console.log(`\npublish result: ${JSON.stringify(published).slice(0, 700)}\n`);
  check('the approved publish ran', published?.success === true, String(published?.error ?? ''));
  check(
    'it reports a verification rather than assuming live',
    typeof published?.verified === 'boolean',
    `verified=${published?.verified} (${published?.verification?.detail ?? ''})`,
  );
  check(
    'the message only claims LIVE when it was verified',
    published?.verified === true
      ? /answered 200/.test(String(published?.message))
      : /SAVED/.test(String(published?.message)) && /do not tell the owner it is live/i.test(String(published?.message)),
    String(published?.message ?? '').slice(0, 160),
  );

  // 4. Fetch it ourselves — the independent check the whole change exists for.
  if (published?.url) {
    const res = await fetch(String(published.url), { headers: { 'User-Agent': 'nobogent-gate' } }).catch((e) => null);
    check(
      'the URL it handed over answers 200 right now',
      Boolean(res && res.ok),
      `${published.url} -> ${res ? res.status : 'no response'}`,
    );
    check(
      'verified agrees with what we just observed',
      published?.verified === Boolean(res && res.ok),
      `verified=${published?.verified} observed=${res ? res.status : 'none'}`,
    );
    check(
      'the advertised URL is not on a domain that does not serve us',
      !String(published.url).includes('procolorfilmacademy.com'),
      String(published.url),
    );
  } else {
    check('it returned a URL', false);
  }
} finally {
  // 5. Leave no trace on the owner's site.
  const del = await sb.from('landing_pages').delete().eq('user_id', ORG).eq('slug', SLUG);
  if (approvalRowId) await sb.from('agent_events').delete().eq('id', approvalRowId);
  await sb
    .from('agent_events')
    .delete()
    .eq('user_id', ORG)
    .eq('event_type', 'PENDING_ACTION_APPROVAL')
    .like('payload->>actionPayload', `%${SLUG}%`)
    .then(() => undefined, () => undefined);
  console.log(`\ncleanup: test page removed (${del.error ? del.error.message : 'ok'})`);
}

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
