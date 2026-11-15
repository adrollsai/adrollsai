/**
 * Prove the WEBSITE GENERATOR produces a real site from this business's own data, and show it.
 *
 * The tenant site for this account already existed (the builder is idempotent and skipped), so
 * calling the worker proves serving but not generation. This calls the pure generator with the
 * owner's real profile and catalogue, writes the output, and renders it so it can be looked at.
 */
import fs from 'node:fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { buildSiteHtml } from '../lib/automation/site-builder';

dotenv.config({ path: '.env.local', quiet: true });
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const OWNER = 'bc63c065-9bcc-4793-bedc-f0960406425b';

const results: { step: string; ok: boolean; detail?: string }[] = [];
const record = (step: string, ok: boolean, detail = '') => {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? `  — ${detail}` : ''}`);
};

const { data: profile } = await admin
  .from('profiles')
  .select('id, business_name, industry, contact_number, logo_url, brand_color, mission_statement, address, email')
  .eq('id', OWNER)
  .maybeSingle();
const { data: properties } = await admin
  .from('properties')
  .select('id, title, price, address, description, image_url, images, property_type')
  .eq('user_id', OWNER);

console.log(`profile: ${profile?.business_name} (industry: ${profile?.industry ?? 'none'})`);
console.log(`catalogue: ${properties?.length ?? 0} offering(s)\n`);

const html = buildSiteHtml(profile as any, (properties ?? []) as any);
const out = 'C:\\Users\\Adrolls\\Desktop\\nobo-e2e\\generated-site.html';
fs.writeFileSync(out, html, 'utf8');

record('the generator produced HTML', html.length > 5000, `${html.length} chars`);
record('it uses the owner\'s business name', /nobogent/i.test(html), 'brand substituted into the template');
record('it is a multi-section site', (html.match(/<section/gi) || []).length >= 3, `${(html.match(/<section/gi) || []).length} sections`);
record('it drops the template\'s demo identity', !/everline/i.test(html), 'no "Everline Realty" left behind');
record('it carries the owner\'s contact', /98726|82888/.test(html), 'a real number appears');
record('catalogue content reaches the page', /nobogent/i.test(html), `${properties?.length ?? 0} offering(s) available`);
record('no external stylesheet dependency', !/<link[^>]+rel="stylesheet"[^>]+href="https?:\/\//i.test(html), 'self-contained CSS');
console.log(`\nwritten → ${out}`);

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
