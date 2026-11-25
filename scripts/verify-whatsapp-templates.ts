/**
 * Can the agent actually see the WhatsApp templates it is told to use?
 *
 * The defect this covers was found by running a real flow: the tool listed templates from the
 * `whatsapp_templates` table, which is EMPTY for an account that never imported into it, so a business with 35
 * APPROVED templates on its WABA was told "there are none" — and "send a test template" was impossible. Nothing
 * errored; the agent was simply told the opposite of the truth, which is the worst shape of bug.
 *
 * So this asserts the fix at the level that matters: the list comes from Meta, it is the same list Meta will accept
 * for sending, it carries the variable count a caller needs, and an account with no WhatsApp connection gets a
 * clear reason instead of a cheerful empty list.
 *
 *   npx esbuild scripts/verify-whatsapp-templates.ts --bundle --platform=node --format=esm --packages=external \
 *     --outfile=.tmp-wa-templates.mjs && node .tmp-wa-templates.mjs
 *
 * Read-only: it lists templates, it never sends one.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createNobogentAppMcpTools } from '../lib/agent/mcp/nobogent_app_mcp';

dotenv.config({ path: '.env.local', quiet: true });

const ADMIN = 'bc63c065-9bcc-4793-bedc-f0960406425b'; // rchopra489@gmail.com, WhatsApp connected
const DISCONNECTED = '00000000-0000-4000-8000-000000000000';

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

console.log('▸ a connected account lists the templates Meta will actually accept');
const tools: any = createNobogentAppMcpTools(sb as any, ADMIN) as any;
const listed = await tools.nobogent_whatsapp_list_templates.execute({}, {});
const templates: any[] = listed?.templates ?? [];
console.log(`  ${listed?.count ?? 0} approved of ${listed?.total ?? 0}; sources: ${(listed?.sources ?? []).join(', ')}`);

check('the list is not empty', templates.length > 0, `${templates.length}`);
check('it came from Meta, not from the local table', (listed?.sources ?? []).some((s: string) => /^meta/.test(s)), (listed?.sources ?? []).join(', '));
check(
  'every listed template is APPROVED, because only those can be sent',
  templates.length > 0 && templates.every((t) => String(t.status).toUpperCase() === 'APPROVED'),
  [...new Set(templates.map((t) => t.status))].join(', '),
);
check(
  'each one carries the locale a send must match',
  templates.every((t) => typeof t.language === 'string' && t.language.length >= 2),
  [...new Set(templates.map((t) => t.language))].slice(0, 4).join(', '),
);
check(
  'and the variable count, so a caller can fill it instead of guessing',
  templates.every((t) => Number.isInteger(t.variables)),
  `e.g. ${templates[0]?.name}: ${templates[0]?.variables} variable(s)`,
);
check(
  'the body text is included, so the agent can see what it is sending',
  templates.filter((t) => String(t.body ?? '').length > 0).length >= Math.ceil(templates.length / 2),
  `${templates.filter((t) => String(t.body ?? '').length > 0).length}/${templates.length} with body text`,
);

console.log('\n▸ the same list, cross-checked against Meta directly');
{
  const { data: profile } = await sb
    .from('profiles')
    .select('whatsapp_waba_id, whatsapp_access_token')
    .eq('id', ADMIN)
    .maybeSingle();
  const res = await fetch(
    `https://graph.facebook.com/v20.0/${profile?.whatsapp_waba_id}/message_templates?fields=name,language,status&limit=250`,
    { headers: { Authorization: `Bearer ${profile?.whatsapp_access_token}` } },
  );
  const body: any = await res.json().catch(() => ({}));
  const metaApproved = (body?.data ?? []).filter((t: any) => String(t.status).toUpperCase() === 'APPROVED');
  check(
    'the tool reports at least as many approved templates as Meta does',
    metaApproved.length > 0 && templates.length >= metaApproved.length,
    `tool ${templates.length} vs meta ${metaApproved.length}`,
  );
  check(
    'every tool row exists on Meta with the same locale',
    templates
      .filter((t) => t.source === 'meta')
      .every((t) => metaApproved.some((m: any) => m.name === t.name && m.language === t.language)),
  );
}

console.log('\n▸ an account with no WhatsApp connection is told why, not given an empty list');
const bare: any = createNobogentAppMcpTools(sb as any, DISCONNECTED) as any;
const empty = await bare.nobogent_whatsapp_list_templates.execute({}, {});
console.log(`  ${JSON.stringify(empty).slice(0, 220)}`);
check('it explains that WhatsApp is not connected', /not connected/i.test(String(empty?.warning ?? '')), String(empty?.warning ?? '').slice(0, 70));
check(
  'and it says there is no approved template to send rather than implying one exists',
  /no approved template to send/i.test(String(empty?.error ?? '')),
  String(empty?.error ?? '').slice(0, 60),
);
check('with no invented rows', (empty?.templates ?? []).length === 0);

// ── the tab's template gallery and broadcast composer ────────────────────────
//
// The WhatsApp tab was functional but thin: conversations, one template send and WABA status. The
// gallery and the composer are new, and the thing worth pinning is not that the panels render - it is
// that the composer CANNOT send. A "Send" button in a second place is exactly how a bulk-message gate
// gets bypassed by accident, so this reads the component's own source and asserts there is no send
// call in it, and that its last step hands off to the conversation that owns the approval card.
console.log('\n-- template gallery, and a composer that cannot send --');
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const component = fs.readFileSync(
    path.join(process.cwd(), 'components/whatsapp/WhatsAppGrowthTools.tsx'),
    'utf8'
  );
  const page = fs.readFileSync(path.join(process.cwd(), 'app/dashboard/whatsapp/page.tsx'), 'utf8');

  check('the gallery lists templates from the Meta-backed route', component.includes('/api/whatsapp/templates'));
  check('it can submit a new template for review', /method:\s*'POST'/.test(component) && /bodyText/.test(component));
  check(
    'it shows the verdict Meta keeps on each template',
    /APPROVED/.test(component) && /PENDING/.test(component) && /REJECTED/.test(component)
  );
  check(
    'it says example templates are not the account own',
    /fallback_unconfigured/.test(component) && /example templates/.test(component)
  );

  check('the composer resolves the real audience', component.includes('/api/whatsapp/broadcasts/preview'));
  check('it will not offer a template Meta has not approved', /approvedTemplates/.test(component));
  check(
    'it shows the recipient count and the rendered message before anything else',
    /validPhoneCount/.test(component) && /renderBody\(/.test(component)
  );
  // THE GATE: no send path in the component at all.
  check(
    'the composer never posts to the broadcast sender',
    !/\/api\/whatsapp\/broadcasts(?!\/preview)/.test(component),
    'a second send path would bypass the approval card'
  );
  check(
    'it hands the prepared broadcast to the agent conversation instead',
    /prepareForApproval/.test(component) && /\?ask=/.test(component) && /agentHref/.test(component)
  );
  check('and says plainly that it does not send', /does not send anything/i.test(component));

  check('the WhatsApp tab mounts it', /WhatsAppGrowthTools/.test(page) && /showGrowthTools/.test(page));
  check('the tab still uses the chat route for conversations', page.includes('/api/whatsapp/chat'));
}

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
