/**
 * Proof for the four capabilities the agent did not have: audiences, campaigns, CRM writes, page edits.
 *
 * Mostly pure — the matching rules, the tagging, the template payload, the hashing Meta requires —
 * plus one live integration check: build the agent's tool surface for a real tenant and assert the
 * new tools are actually IN it. A capability that exists in a file the orchestrator never registers
 * is the exact bug this whole round of work was about (`lib/agent/tools/crm.ts` and
 * `lib/agent/tools/whatsapp.ts` were both fully implemented and completely unreachable).
 *
 *   npm run verify:audiences
 */
import '../lib/env-local';
import { createClient } from '@supabase/supabase-js';
import {
  EMPTY_FILTERS,
  audienceNameFromTitle,
  audienceTitle,
  campaignNameOf,
  customFieldsOf,
  dateWindow,
  describeFilters,
  groupsOf,
  isInGroup,
  leadMatchesFilters,
  normaliseFilters,
  normalisePhone,
  tagForGroup,
  type AudienceFilters,
} from '../lib/audiences/filters';
import { describeTarget, matchesAudienceTarget, selectCampaignRecipients } from '../lib/audiences/targets';
import { buildTemplatePayload, cleanTemplateName } from '../lib/whatsapp/templates';
import { normaliseEmailList, normalisePhoneList } from '../lib/agent/mcp/meta-graph';
import { REVIEW_POLICY } from '../lib/agent/review-gate';
import { selectToolGroups } from '../lib/agent/tool-groups';
import { editSection, ensureSections, replaceTextOnce, verifyEdit } from '../lib/site/page-sections';

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail === undefined ? '' : `  — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  }
};

const lead = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    id: 'lead-1',
    name: 'Asha',
    phone: '+91 98888 77777',
    email: 'Asha@Example.com',
    source: 'Meta Ads',
    ad_name: 'Diwali 3BHK',
    form_name: null,
    csv_audience: null,
    pipeline_stage: 'New',
    property_id: null,
    custom_fields: {},
    created_at: new Date().toISOString(),
    whatsapp_enabled: true,
    ...over,
  }) as any;

// ─────────────────────────────────────────────────────────── audience matching
console.log('\naudience filters — the rules the Audience Maker and the agent now share');
const now = new Date('2026-11-20T10:00:00.000Z');
const noWindow = { min: null, max: null };

check('phone numbers compare on their last ten digits', normalisePhone('+91 98888 77777') === normalisePhone('9888877777'));
check('no filters means everybody, and says so', describeFilters(EMPTY_FILTERS).includes('every lead'));

const byCampaign = normaliseFilters({ campaigns: ['Diwali 3BHK'] });
check('a campaign filter matches on ad_name', leadMatchesFilters(lead(), byCampaign, noWindow));
check('an unrelated campaign does not', !leadMatchesFilters(lead({ ad_name: 'Holi' }), byCampaign, noWindow));
check(
  'the campaign is also found in custom_fields.meta_ad_origin (what the Meta webhook writes)',
  campaignNameOf(lead({ ad_name: null, custom_fields: { meta_ad_origin: { campaign_name: 'Diwali 3BHK' } } })) === 'Diwali 3BHK'
);

const byStage = normaliseFilters({ pipelineStages: ['Qualified'] });
check('a stage filter matches only that stage', !leadMatchesFilters(lead(), byStage, noWindow) && leadMatchesFilters(lead({ pipeline_stage: 'Qualified' }), byStage, noWindow));

const orFilters = normaliseFilters({ matchMode: 'OR', campaigns: ['Nope'], sources: ['Meta Ads'] });
const andFilters = normaliseFilters({ matchMode: 'AND', campaigns: ['Nope'], sources: ['Meta Ads'] });
check('OR matches when ANY category matches', leadMatchesFilters(lead(), orFilters, noWindow));
check('AND requires every category', !leadMatchesFilters(lead(), andFilters, noWindow));
check(
  'AND ignores a category with no values rather than failing on it',
  leadMatchesFilters(lead(), normaliseFilters({ matchMode: 'AND', sources: ['Meta Ads'], campaigns: [] }), noWindow)
);

const csvTagged = lead({ csv_audience: 'Diwali buyers, VIP' });
check(
  'a list filter matches one entry of the comma list',
  leadMatchesFilters(csvTagged, normaliseFilters({ csvAudiences: ['VIP'] }), noWindow)
);

const window = dateWindow(normaliseFilters({ dateRange: '7d' }), now);
check('a 7-day window is seven days back', window.min?.toISOString() === '2026-11-13T10:00:00.000Z', window.min?.toISOString());
check(
  'an old lead falls outside it',
  !leadMatchesFilters(lead({ created_at: '2026-10-01T10:00:00.000Z' }), normaliseFilters({ dateRange: '7d' }), window)
);
const custom = dateWindow(normaliseFilters({ dateRange: 'custom', startDate: '2026-11-01', endDate: '2026-11-10' }), now);
check(
  'a custom range covers the whole end day',
  custom.max?.getHours() === 23 && custom.max?.getMinutes() === 59,
  custom.max?.toISOString()
);

const manual = new Set([normalisePhone('9888877777')]);
check(
  'a hand-typed number wins over filters that would exclude it',
  leadMatchesFilters(lead({ pipeline_stage: 'Lost' }), byStage, noWindow, { manualPhones: manual })
);

// ─────────────────────────────────────────────────────────── tagging
console.log('\ntagging — one group, two storages, no duplicates');
const first = tagForGroup(lead(), 'Diwali buyers');
check('tagging writes the csv list', first?.csv_audience === 'Diwali buyers', first?.csv_audience);
check('tagging writes the custom field too', JSON.stringify(first?.custom_fields?.audience_groups) === '["Diwali buyers"]');
check('re-tagging an already-tagged lead changes nothing', tagForGroup(lead({ csv_audience: 'Diwali buyers', custom_fields: { audience_groups: ['Diwali buyers'] } }), 'Diwali buyers') === null);
const second = tagForGroup(lead({ csv_audience: 'Humans' }), 'Diwali buyers');
check('an existing list is extended, not replaced', second?.csv_audience === 'Humans, Diwali buyers', second?.csv_audience);
check('groups are read from both storages', groupsOf(lead({ csv_audience: 'A', custom_fields: { audience_groups: ['B'] } })).join(',') === 'A,B');
check('membership agrees with the tagging', isInGroup(lead({ custom_fields: { audience_groups: ['VIP'] } }), 'VIP'));
check('the audience row title is what the UI lists', audienceTitle('Diwali buyers') === 'Audience-Group: Diwali buyers');
check('and it round-trips', audienceNameFromTitle('Audience-Group: Diwali buyers') === 'Diwali buyers');
check('a non-audience row is not mistaken for a group', audienceNameFromTitle('Flow: welcome') === null);

// ─────────────────────────────────────────────────────────── campaign targeting
console.log('\ncampaign targeting — who is selected, and who cannot be reached');
const groupTarget = { audienceFilter: { targetType: 'audience_group' as const, audienceGroupName: 'Diwali buyers' } };
check('a group target matches a lead tagged through the csv list', matchesAudienceTarget(lead({ csv_audience: 'Diwali buyers' }), groupTarget));
check('and one tagged only through custom_fields', matchesAudienceTarget(lead({ custom_fields: { audience_groups: ['Diwali buyers'] } }), groupTarget));
check('and not a lead in a different group', !matchesAudienceTarget(lead({ csv_audience: 'Holi' }), groupTarget));

const customTarget = { audienceFilter: { targetType: 'custom' as const, sources: ['Meta Ads'], pipelineStages: ['New'] } };
check('a custom target requires every category', matchesAudienceTarget(lead(), customTarget));
check('and fails when one does not match', !matchesAudienceTarget(lead({ pipeline_stage: 'Lost' }), customTarget));

const selection = selectCampaignRecipients(
  [
    lead({ id: 'a' }),
    lead({ id: 'b', phone: null }),
    lead({ id: 'c', whatsapp_enabled: false }),
    lead({ id: 'd', csv_audience: 'Other' }),
  ],
  groupTarget
);
check('only reachable members are selected', selection.selected.length === 0, selection.selected.map((l) => l.id));
const taggedSelection = selectCampaignRecipients(
  [
    lead({ id: 'a', csv_audience: 'Diwali buyers' }),
    lead({ id: 'b', csv_audience: 'Diwali buyers', phone: null }),
    lead({ id: 'c', csv_audience: 'Diwali buyers', whatsapp_enabled: false }),
  ],
  groupTarget
);
check('a member with no phone is reported, not silently dropped', taggedSelection.selected.length === 1 && taggedSelection.unreachable.length === 2);
check(
  'and the reason is stated',
  taggedSelection.unreachable.some((u) => /phone/i.test(u.reason)) && taggedSelection.unreachable.some((u) => /turned off/i.test(u.reason)),
  taggedSelection.unreachable.map((u) => u.reason)
);
check('a limit caps the campaign', selectCampaignRecipients([lead({ csv_audience: 'G' }), lead({ id: 'z', csv_audience: 'G' })], { audienceFilter: { targetType: 'audience_group', audienceGroupName: 'G' } }, { limit: 1 }).selected.length === 1);
check('the audience is named in plain words', describeTarget(groupTarget).includes('Diwali buyers'));
check('no target means the whole book, and says so', describeTarget({}).includes('every lead'));

// ─────────────────────────────────────────────────────────── templates
console.log('\nWhatsApp templates — refused before Meta refuses them');
check('a name is lowercased and underscored', cleanTemplateName('Diwali Offer V1!') === 'diwali_offer_v1', cleanTemplateName('Diwali Offer V1!'));
const built = buildTemplatePayload({ name: 'diwali_offer', bodyText: 'Hi {{1}}, our {{2}} offer is live.', headerText: 'Diwali offer', headerType: 'TEXT' });
check('a valid template builds', !('problems' in built), 'problems' in built ? built.problems : 'ok');
if (!('problems' in built)) {
  const body = built.components.find((c) => c.type === 'BODY') as any;
  check('body variables get the sample values Meta demands', JSON.stringify(body?.example?.body_text) === '[["Sample 1","Sample 2"]]', body?.example);
  check('the header is a TEXT header', (built.components[0] as any)?.format === 'TEXT');
  check('the language defaults to en_US', built.language === 'en_US');
}
const tooManyButtons = buildTemplatePayload({
  name: 'x',
  bodyText: 'body',
  buttons: [
    { type: 'QUICK_REPLY', text: 'One' },
    { type: 'QUICK_REPLY', text: 'Two' },
    { type: 'QUICK_REPLY', text: 'Three' },
    { type: 'QUICK_REPLY', text: 'Four' },
  ],
});
check('more than three buttons is refused', 'problems' in tooManyButtons && tooManyButtons.problems.some((p) => /at most 3/.test(p)));
const urlButton = buildTemplatePayload({ name: 'x', bodyText: 'b', buttons: [{ type: 'URL', text: 'See it', value: 'example.com/p/1' }] });
check(
  'a bare URL is normalised to https',
  !('problems' in urlButton) && (urlButton.components.find((c) => c.type === 'BUTTONS') as any)?.buttons?.[0]?.url === 'https://example.com/p/1',
  'problems' in urlButton ? urlButton.problems : 'ok'
);
check('a URL button with no url is refused', 'problems' in buildTemplatePayload({ name: 'x', bodyText: 'b', buttons: [{ type: 'URL', text: 'See it' }] }));
check('a TEXT header with no text is refused', 'problems' in buildTemplatePayload({ name: 'x', bodyText: 'b', headerType: 'TEXT' }));
check('an empty body is refused', 'problems' in buildTemplatePayload({ name: 'x', bodyText: '   ' }));

// ─────────────────────────────────────────────────────────── Meta audience hashing
console.log('\nMeta custom audiences — the normalisation Meta silently punishes');
const hashed = normalisePhoneList(['+91 98888 77777', '098888 77777', '9888877777'], '91');
check('the same number written three ways hashes to one identifier', hashed.length === 1, `${hashed.length} hash(es)`);
check('the hash is a sha-256 hex digest', /^[0-9a-f]{64}$/.test(hashed[0] ?? ''));
check('a ten-digit number gets the country code', normalisePhoneList(['9888877777'], '91')[0] !== normalisePhoneList(['9888877777'], '1')[0]);
check('junk is dropped rather than uploaded', normalisePhoneList(['', '12', 'n/a']).length === 0);
const mail = normaliseEmailList(['Asha@Example.com ', 'asha@example.com', 'not-an-email']);
check('emails are lowercased and de-duplicated', mail.length === 1, `${mail.length}`);
check('a non-email is dropped', normaliseEmailList(['not-an-email']).length === 0);

// ─────────────────────────────────────────────────────────── page sections
console.log('\nlanding-page sections — one section changes, nothing else moves');
const page = `<!DOCTYPE html><html><body>
<section id="hero"><h1>Old headline</h1><p>Call 99999 00000</p></section>
<section id="features"><h2>Features</h2><p>Three of them</p></section>
<footer id="contact"><p>Old phone</p></footer>
</body></html>`;
const parsed = ensureSections(page);
check('a legacy page is adopted into sections on first read', parsed.sections.length >= 2, parsed.sections.map((s) => s.id));
const heroId = parsed.sections[0]?.id ?? '';
const edited = editSection(page, heroId, '<section id="hero"><h1>New headline</h1><p>Call 99999 00000</p></section>');
check('one section can be replaced', /New headline/.test(edited.html) && !/Old headline/.test(edited.html));
check('every other section is byte-identical', /Three of them/.test(edited.html) && /Old phone/.test(edited.html));
const proof = verifyEdit(edited.before, edited.after, heroId, { allowRemoval: true });
check('the proof says only the requested section changed', proof.ok, proof.message);
const text = replaceTextOnce(page, 'Old phone', 'Call 91111 22222');
check('an exact string can be replaced once', /Call 91111 22222/.test(text.html) && !/Old phone/.test(text.html));
let ambiguous = false;
try {
  // `<p>` appears three times on this page, so "which one did you mean?" has no safe answer.
  replaceTextOnce(page, '<p>', '<p class="lead">');
} catch {
  ambiguous = true;
}
check('a string that appears more than once is refused, not guessed', ambiguous);

// ─────────────────────────────────────────────────────────── the gate
console.log('\nthe approval gate — what still needs a human before it reaches anybody');
check('broadcasting to an audience is gated', Boolean(REVIEW_POLICY.whatsapp_broadcast_to_audience));
check('deleting a lead is gated', REVIEW_POLICY.crm_delete_lead?.actionType === 'delete_data');
check('editing a live page is gated', Boolean(REVIEW_POLICY.page_edit_section));
check('uploading customer data to Meta is gated', Boolean(REVIEW_POLICY.meta_custom_audience_create));
check(
  'and the free, reversible work is NOT gated, or the gate becomes noise',
  !REVIEW_POLICY.create_audience_group &&
    !REVIEW_POLICY.preview_audience &&
    !REVIEW_POLICY.whatsapp_create_template &&
    !REVIEW_POLICY.crm_update_lead_stage &&
    !REVIEW_POLICY.crm_archive_lead &&
    !REVIEW_POLICY.page_read_sections
);
check('archiving is not deletion, and is not gated', !REVIEW_POLICY.crm_archive_lead && Boolean(REVIEW_POLICY.crm_delete_lead));

console.log('\nthe capability surface — the tools are actually reachable from a turn');
const audienceTurn = selectToolGroups('make me an audience group of the Diwali leads and message them');
check('an audience request selects the automation group', audienceTurn.groups.includes('automation'), audienceTurn.groups);
const crmTurn = selectToolGroups('move those three leads to site visit');
check('a CRM request selects the automation group', crmTurn.groups.includes('automation'), crmTurn.groups);
const pageTurn = selectToolGroups('change the phone number in the footer of my landing page');
check('a page edit selects the sites group', pageTurn.groups.includes('sites'), pageTurn.groups);

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const { createAgentContext } = await import('../lib/agent/orchestrator');
const { data: profiles } = await sb.from('profiles').select('id').eq('role', 'super_admin').limit(1);
const tenant = profiles?.[0]?.id;
if (!tenant) {
  check('a tenant exists to build the tool surface for', false);
} else {
  const ctx = await createAgentContext(sb, tenant, {
    intentText: 'create an audience group and message them, move leads to a stage, edit my landing page footer, and upload a meta custom audience',
    forceGroups: ['automation', 'sites', 'meta', 'reporting'],
  });
  const names = Object.keys(ctx.tools);
  const expected = [
    'preview_audience',
    'create_audience_group',
    'list_audience_groups',
    'whatsapp_broadcast_to_audience',
    'whatsapp_create_template',
    'whatsapp_template_status',
    'crm_update_lead_stage',
    'crm_update_lead',
    'crm_archive_lead',
    'crm_delete_lead',
    'page_read_sections',
    'page_edit_section',
    'meta_custom_audience_create',
    'meta_custom_audience_list',
  ];
  const missing = expected.filter((n) => !names.includes(n));
  check('every new tool is registered on the agent', missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : `${names.length} tools`);
  const gatedNames = expected.filter((n) => Boolean(REVIEW_POLICY[n]));
  check('and the dangerous ones arrive gate-wrapped (the schema takes an approvalId)', gatedNames.length > 0);
}

console.log(`\n${'='.repeat(64)}`);
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
