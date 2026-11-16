/**
 * Is the domain the agent advertises actually attached to US?
 *
 * Found live: site_domain_status reported "Pages are served on the customer's own domain" and
 * produced https://www.procolorfilmacademy.com/shared/<id>/<slug>, which is a 404 — the domain
 * 301s to an apex that runs WordPress. The same page on the platform host returns 200. So the tool
 * hands the owner a URL that does not work, which is the exact failure the brief calls out.
 *
 * profiles carries domain_verify_status and whitelabel_verify_status, so the app can already tell a
 * domain that was CONFIGURED from one that was PROVEN. This reports what those columns hold and
 * whether the domain actually answers, so the fallback can be based on evidence.
 *
 * Read-only. Attaches nothing.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local', quiet: true });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

const r = await sb
  .from('profiles')
  .select('id, business_name, custom_domain, domain_verify_status, domain_verify_token, whitelabel_domain, whitelabel_verify_status')
  .not('custom_domain', 'is', null)
  .limit(20);

if (r.error) {
  console.log('query error:', r.error.message);
  process.exit(1);
}

const rows = (r.data ?? []).filter((row: any) => String(row.custom_domain || '').trim());
console.log(`profiles with a custom_domain: ${rows.length}\n`);

for (const row of rows as any[]) {
  console.log(`--- ${row.business_name} (${String(row.id).slice(0, 8)}…)`);
  console.log(`    custom_domain        : ${row.custom_domain}`);
  console.log(`    domain_verify_status : ${row.domain_verify_status ?? '(null)'}`);
  console.log(`    domain_verify_token  : ${row.domain_verify_token ? 'set' : '(null)'}`);
  console.log(`    whitelabel_domain    : ${row.whitelabel_domain ?? '(null)'}`);
  console.log(`    whitelabel_status    : ${row.whitelabel_verify_status ?? '(null)'}`);

  // Does the domain actually answer as Nobogent, or is it somebody else's site?
  const domain = String(row.custom_domain).replace(/^https?:\/\//, '').replace(/\/$/, '');
  try {
    const res = await fetch(`https://${domain}/`, { redirect: 'manual' });
    const server = res.headers.get('server') ?? '';
    const link = res.headers.get('link') ?? '';
    const body = res.status === 200 ? (await res.text()).slice(0, 4000) : '';
    const fingerprint = /wp-content|wp-json|wordpress/i.test(body + link)
      ? 'WORDPRESS (not us)'
      : /_next|nobogent|pipixel/i.test(body)
        ? 'looks like a Nobogent build'
        : 'unknown';
    console.log(`    live            : HTTP ${res.status}  server=${server}  -> ${fingerprint}`);
    if (link) console.log(`    link header     : ${link.slice(0, 120)}`);
  } catch (error: any) {
    console.log(`    live            : FAILED ${String(error?.message ?? error).slice(0, 100)}`);
  }
  console.log('');
}
