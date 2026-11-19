/**
 * Do the four new capabilities actually work, on the live database?
 *
 * The gate (verify:audiences) proves the rules. This proves the WIRING: that an audience group built
 * by the agent's tool is a group the CRM filter and the campaign targeting both recognise, that a
 * broadcast queues real recipient rows, that a CRM write lands and leaves its history, that a page
 * section edit changes one section and nothing else, and that the two things which must never happen
 * silently (deleting a lead, editing a live page without a decision) are refused by the gate.
 *
 * NOTHING IS SENT AND NOTHING IS SPENT: the broadcast is created and then deleted before any cron
 * tick could pick it up, no template is created, and no Meta audience is uploaded. Every row it makes
 * is removed afterwards, including on failure.
 *
 *   npm run accept:capabilities
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function env(name: string): string {
  const raw = fs.readFileSync('.env.local', 'utf8');
  const m = raw.match(new RegExp('^' + name + '=(.*)$', 'm'));
  if (!m) throw new Error(`missing ${name}`);
  return m[1].trim().replace(/^["']|["']$/g, '');
}

const OWNER = 'bc63c065-9bcc-4793-bedc-f0960406425b';
const admin = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : `  — ${typeof detail === 'string' ? detail : JSON.stringify(detail)?.slice(0, 400)}`}`);
  }
};

const cleanup: Array<() => Promise<unknown>> = [];

async function main() {
  const runId = Date.now().toString(36);
  const groupName = `__cap ${runId}`;
  const leadIds: string[] = [];

  // ── probe leads: two in the audience, one outside it, one unreachable
  const insert = async (over: Record<string, unknown>) => {
    const { data, error } = await admin
      .from('leads')
      .insert({
        user_id: OWNER,
        source: 'capability_probe',
        pipeline_stage: 'New',
        status: 'active',
        ...over,
      })
      .select('id')
      .single();
    if (error || !data?.id) throw new Error(`could not create a probe lead: ${error?.message}`);
    leadIds.push(String(data.id));
    return String(data.id);
  };

  const inA = await insert({ name: `[cap ${runId}] A`, phone: '918288835235', ad_name: 'Capability Probe Campaign' });
  const inB = await insert({ name: `[cap ${runId}] B`, phone: '918288835236', ad_name: 'Capability Probe Campaign' });
  const outside = await insert({ name: `[cap ${runId}] C`, phone: '918288835237', ad_name: 'Some Other Campaign' });
  const unreachable = await insert({ name: `[cap ${runId}] D`, phone: null, ad_name: 'Capability Probe Campaign' });

  cleanup.push(async () => {
    for (const id of leadIds) {
      await admin.from('agent_pending_deliveries').delete().eq('lead_id', id);
      await admin.from('lead_history').delete().eq('lead_id', id);
      await admin.from('whatsapp_broadcast_recipients').delete().eq('lead_id', id);
      await admin.from('leads').delete().eq('id', id);
    }
    await admin.from('automations').delete().eq('user_id', OWNER).eq('title', `Audience-Group: ${groupName}`);
  });

  const { createAudienceTools } = await import('../lib/agent/tools/audiences');
  const { createCrmWriteTools } = await import('../lib/agent/tools/crm-writes');
  const { createPageEditTools } = await import('../lib/agent/tools/page-edit');
  const { createMessagingTools } = await import('../lib/agent/tools/messaging');
  const audiences = createAudienceTools(admin, OWNER) as any;
  const crm = createCrmWriteTools(admin, OWNER) as any;
  const pages = createPageEditTools(admin, OWNER) as any;
  const messaging = createMessagingTools(admin, OWNER) as any;

  // ── 1. the audience
  console.log('\n1. an audience group the agent builds is a group the CRM recognises');
  const preview = await audiences.preview_audience.execute({
    filters: { campaigns: ['Capability Probe Campaign'] },
  });
  check('preview counts real leads without creating anything', preview?.success === true, preview?.error);
  check('and finds the three probe leads', Number(preview?.count ?? 0) >= 3, preview?.count);

  const created = await audiences.create_audience_group.execute({
    name: groupName,
    description: 'capability probe',
    filters: { campaigns: ['Capability Probe Campaign'] },
  });
  check('the group is created', created?.success === true, created?.error);
  check('with the right lead count', Number(created?.leadCount ?? 0) >= 3, created?.leadCount);
  check('and it reports how many leads it tagged', Number(created?.newlyTagged ?? 0) >= 3, created?.newlyTagged);

  const { data: groupRow } = await admin
    .from('automations')
    .select('id, title, description, stats')
    .eq('user_id', OWNER)
    .eq('title', `Audience-Group: ${groupName}`)
    .maybeSingle();
  check('the group row exists in the shape the UI lists', Boolean(groupRow?.id), groupRow?.title);
  let config: any = null;
  try {
    config = JSON.parse(String((groupRow as any)?.description ?? ''));
  } catch {
    config = null;
  }
  check('the filters are stored so the group can be re-synced', config?.filters?.campaigns?.[0] === 'Capability Probe Campaign', config?.filters);

  const { data: tagged } = await admin.from('leads').select('id, csv_audience, custom_fields').in('id', [inA, inB, outside]);
  const { customFieldsOf } = await import('../lib/audiences/filters');
  const inGroup = (tagged ?? []).filter((l: any) =>
    String(l.csv_audience ?? '')
      .split(',')
      .map((s: string) => s.trim())
      .includes(groupName)
  );
  check('exactly the matching leads were tagged', inGroup.length === 2, (tagged ?? []).map((l: any) => l.csv_audience));
  // `custom_fields` is a TEXT column holding JSON in this database, so it must be parsed before it
  // can be read — the same reason the audience code handles both shapes.
  const groupArrays = inGroup.map((l: any) => customFieldsOf(l).audience_groups ?? []);
  check(
    'and tagged in BOTH storages so the CRM filter and the campaign agree',
    groupArrays.every((groups: string[]) => groups.includes(groupName)),
    groupArrays
  );

  const listed = await audiences.list_audience_groups.execute({});
  check(
    'it appears in the group list',
    (listed?.groups ?? []).some((g: any) => g.name === groupName),
    (listed?.groups ?? []).map((g: any) => g.name)
  );

  // ── 2. the campaign (queued, then removed before any scheduler tick)
  console.log('\n2. a campaign queues real recipients — behind approval');
  const before = await admin.from('whatsapp_broadcasts').select('id', { count: 'exact', head: true }).eq('user_id', OWNER);
  const campaign = await audiences.whatsapp_broadcast_to_audience.execute({
    title: `[cap ${runId}] probe campaign`,
    templateName: 'definitely_not_a_real_template_name',
    audienceGroupName: groupName,
  });
  check(
    'a campaign with a template Meta does not have is refused, not queued',
    campaign?.success === false && JSON.stringify(campaign?.problems ?? []).includes('definitely_not_a_real_template_name'),
    campaign?.problems ?? campaign?.error
  );
  const after = await admin.from('whatsapp_broadcasts').select('id', { count: 'exact', head: true }).eq('user_id', OWNER);
  check('and it wrote nothing', (after.count ?? 0) === (before.count ?? 0), `${before.count} -> ${after.count}`);

  const templates = await messaging.whatsapp_template_status.execute({ onlyApproved: true });
  const approved = (templates?.templates ?? [])[0];
  if (!approved) {
    console.log('   (no APPROVED template on this account, so the queuing half is proven with a real one skipped)');
  } else {
    const queued = await audiences.whatsapp_broadcast_to_audience.execute({
      title: `[cap ${runId}] probe campaign`,
      templateName: approved.name,
      audienceGroupName: groupName,
    });
    check('an approved template queues a campaign', queued?.success === true, queued?.problems ?? queued?.error);
    check('with one recipient per reachable member', Number(queued?.recipients ?? 0) === 2, queued?.recipients);
    check(
      'and the unreachable member is reported with the reason',
      (queued?.unreachable ?? []).some((u: any) => /phone/i.test(String(u.reason))),
      queued?.unreachable
    );
    if (queued?.broadcastId) {
      const broadcastId = String(queued.broadcastId);
      const { data: recipients } = await admin
        .from('whatsapp_broadcast_recipients')
        .select('id, lead_id, status')
        .eq('broadcast_id', broadcastId);
      check('the recipient rows are pending, so nothing has been sent', (recipients ?? []).every((r: any) => r.status === 'pending'), (recipients ?? []).map((r: any) => r.status));
      // Take it out again immediately: this probe must not message anybody if a cron ticks.
      await admin.from('whatsapp_broadcast_recipients').delete().eq('broadcast_id', broadcastId);
      await admin.from('whatsapp_broadcasts').delete().eq('id', broadcastId);
      const { data: gone } = await admin.from('whatsapp_broadcasts').select('id').eq('id', broadcastId).maybeSingle();
      check('the probe campaign is removed again, so no cron can send it', gone === null);
    }
  }

  // ── 3. CRM writes
  console.log('\n3. CRM writes land, leave a trail, and deletion is gated');
  const staged = await crm.crm_update_lead_stage.execute({ leadId: inA, stage: 'Qualified', note: 'capability probe' });
  check('a stage change is accepted', staged?.success === true, staged?.error ?? staged?.problems);
  const { data: moved } = await admin.from('leads').select('pipeline_stage, status').eq('id', inA).maybeSingle();
  check('the stage really changed', (moved as any)?.pipeline_stage === 'Qualified', moved);
  const { data: history } = await admin.from('lead_history').select('description').eq('lead_id', inA);
  check(
    'the change left a history row naming the old and new stage',
    (history ?? []).some((h: any) => /New → Qualified/.test(String(h.description))),
    (history ?? []).map((h: any) => h.description)
  );

  const details = await crm.crm_update_lead.execute({ leadId: inB, budget: '80 lakh', notes: 'capability probe note' });
  check('a details update is accepted', details?.success === true, details?.error ?? details?.problems);
  const { data: updated } = await admin.from('leads').select('budget, notes').eq('id', inB).maybeSingle();
  check('and it wrote the fields it was given', (updated as any)?.budget === '80 lakh' && /probe note/.test(String((updated as any)?.notes ?? '')), updated);

  const archived = await crm.crm_archive_lead.execute({ leadId: unreachable, reason: 'probe' });
  check('archiving works and keeps the record', archived?.success === true, archived?.error);
  const { data: arch } = await admin.from('leads').select('pipeline_stage').eq('id', unreachable).maybeSingle();
  check('the archived lead is still there', (arch as any)?.pipeline_stage === 'archived', arch);

  // The gate is what stops deletion, and the gate is applied by the orchestrator — so assert the
  // policy rather than expecting the raw tool to refuse.
  const { REVIEW_POLICY } = await import('../lib/agent/review-gate');
  check('deleting a lead needs approval', REVIEW_POLICY.crm_delete_lead?.actionType === 'delete_data');
  check('archiving does not', !REVIEW_POLICY.crm_archive_lead);

  // ── 4. page sections
  console.log('\n4. a page section can be edited without regenerating the page');
  const slug = `cap-probe-${runId}`;
  const html = `<!DOCTYPE html><html><body>
<section id="hero"><h1>Probe hero</h1><p>Call 99999 00000</p></section>
<section id="features"><h2>Features</h2><p>Unchanged text</p></section>
<footer id="contact"><p>Old phone number</p></footer>
</body></html>`;
  const { data: page, error: pageError } = await admin
    .from('landing_pages')
    .insert({ user_id: OWNER, slug, title: `[cap ${runId}] probe page`, html_content: html })
    .select('id')
    .single();
  if (pageError || !page?.id) throw new Error(`could not create the probe page: ${pageError?.message}`);
  cleanup.push(async () => {
    await admin.from('landing_pages').delete().eq('id', (page as any).id);
  });

  const read = await pages.page_read_sections.execute({ slug });
  check('the page is read as sections', read?.success === true && (read?.sections ?? []).length >= 2, read?.error ?? read?.sections);
  const hero = (read?.sections ?? []).find((s: any) => /hero/i.test(String(s.id))) ?? (read?.sections ?? [])[0];
  const one = await pages.page_read_sections.execute({ slug, section: hero.id });
  check('one section can be read with its HTML', one?.success === true && String(one?.section?.html ?? '').length > 0, one?.error);

  const edit = await pages.page_edit_section.execute({ slug, find: 'Old phone number', replace: 'Call 91111 22222' });
  check('an exact text edit is applied', edit?.success === true, edit?.error ?? edit?.problems);
  const { data: afterEdit } = await admin.from('landing_pages').select('html_content').eq('id', (page as any).id).maybeSingle();
  const afterHtml = String((afterEdit as any)?.html_content ?? '');
  check('the new text is on the page', /91111 22222/.test(afterHtml));
  check('and the rest of the page is untouched', /Probe hero/.test(afterHtml) && /Unchanged text/.test(afterHtml));

  const badEdit = await pages.page_edit_section.execute({ slug, find: 'text that is not there', replace: 'x' });
  check('an edit whose text is not on the page is refused', badEdit?.success === false, badEdit?.error);
  const bothPlans = await pages.page_edit_section.execute({ slug, section: hero.id, html: '<section>hi</section>', find: 'a', replace: 'b' });
  check('giving both an html plan and a find plan is refused', bothPlans?.success === false, bothPlans?.error);
  check('and a live page edit needs approval', Boolean(REVIEW_POLICY.page_edit_section));

  // ── 5. templates
  console.log('\n5. the WhatsApp template tool talks to Meta (or says why it cannot)');
  const badTemplate = await messaging.whatsapp_create_template.execute({ name: 'Cap Probe', bodyText: '' });
  check('an invalid template is refused before Meta is called', badTemplate?.success === false && (badTemplate?.problems ?? []).length > 0, badTemplate?.problems);
  const status = await messaging.whatsapp_template_status.execute({});
  check('the account\'s real templates are listed', status?.success === true, status?.error);
  console.log(`   templates at Meta: ${status?.count ?? 0} (${status?.approvedCount ?? 0} approved)`);

  // ── 6. Meta audience hashing (no upload: the gate is asserted, the addresses are checked)
  console.log('\n6. Meta custom audiences — payload correct, upload gated');
  const { normalisePhoneList, normaliseEmailList } = await import('../lib/agent/mcp/meta-graph');
  check('phone normalisation produces one hash per person', normalisePhoneList(['+91 82888 35235', '8288835235'], '91').length === 1);
  check('email normalisation lowercases and hashes', normaliseEmailList(['A@B.com'])[0]?.length === 64);
  check('uploading customer data to Meta needs approval', Boolean(REVIEW_POLICY.meta_custom_audience_create));
}

async function run() {
  try {
    await main();
  } catch (error: any) {
    fail++;
    console.log(`  FAIL probe crashed: ${String(error?.message || error)}`);
  } finally {
    for (const undo of cleanup.reverse()) {
      try {
        await undo();
      } catch (error: any) {
        console.warn(`  cleanup warning: ${String(error?.message || error)}`);
      }
    }
    console.log(`\n${'='.repeat(64)}`);
    console.log(`${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  }
}

void run();
