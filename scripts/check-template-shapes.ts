/**
 * What do these templates ACTUALLY require?
 *
 * Meta reports a parameter mismatch (132012) even when the body text looks placeholder-free, so the
 * only reliable way to pick a template this proof can send is to look at the real components: header
 * format, named vs positional parameters, button types.
 *
 * Read-only. Sends nothing.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local', quiet: true });

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
);

const owner = await admin
  .from('profiles')
  .select('facebook_token, whatsapp_waba_id, whatsapp_phone_number_id')
  .eq('email', 'rchopra489@gmail.com')
  .maybeSingle();

const token = String((owner.data as any)?.facebook_token || '').replace(/^["']|["']$/g, '').trim();
const wabaId = String((owner.data as any)?.whatsapp_waba_id || '');
console.log(`waba: ${wabaId}, phone id: ${(owner.data as any)?.whatsapp_phone_number_id}`);

const res = await fetch(
  `https://graph.facebook.com/v20.0/${wabaId}/message_templates?fields=name,status,language,category,parameter_format,components&limit=100`,
  { headers: { Authorization: `Bearer ${token}` } },
);
const body: any = await res.json().catch(() => ({}));
const all: any[] = body?.data ?? [];
console.log(`total templates: ${all.length}`);

const candidates = all.filter((t) => t.status === 'APPROVED');
console.log(`approved: ${candidates.length}\n`);

for (const t of candidates) {
  const comps = t.components ?? [];
  const kinds = comps.map((c: any) => c.type).join('+');
  const headerFormat = comps.find((c: any) => String(c.type).toUpperCase() === 'HEADER')?.format ?? '-';
  const bodyText = comps.find((c: any) => String(c.type).toUpperCase() === 'BODY')?.text ?? '';
  const holes = bodyText.match(/\{\{[^}]+\}\}/g) ?? [];
  const buttons = comps.find((c: any) => String(c.type).toUpperCase() === 'BUTTONS')?.buttons ?? [];
  const buttonSummary = buttons
    .map((b: any) => `${b.type}${b.url ? '(' + b.url.replace(/https?:\/\//, '').slice(0, 24) + ')' : ''}`)
    .join(',');
  console.log(
    `${t.name} [${t.language}] fmt=${t.parameter_format ?? 'positional'} header=${headerFormat} ` +
      `holes=[${holes.join(' ')}] comps=${kinds} buttons=${buttonSummary || 'none'}`,
  );
}
