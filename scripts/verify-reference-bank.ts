import '../lib/env-local';
import {
  bankStatus,
  imageReferences,
  pageReferences,
  referenceBrief,
  referenceMenu,
  referencesFor,
  videoReferences,
} from '../lib/agent/creative/reference-bank';
import {
  GENERATED_FOOTAGE_CAP_SEC,
  MEDIA_RULES,
  SCENE_PACK_SEC,
  decideMediaPlan,
  mediaRulesBlock,
  productAssets,
  type TenantAsset,
} from '../lib/agent/creative/media-strategy';
import { createReferenceBankTools } from '../lib/agent/tools/reference_bank';

let passed = 0;
let failed = 0;
const check = (label: string, ok: boolean) => {
  if (ok) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}`);
  }
};

console.log('reference bank');
const status = bankStatus();
check(`bank loads (${status.videos} video, ${status.images} image, ${status.pages} page references)`, status.videos + status.images + status.pages > 0);
check('at least one video reference is banked', status.videos >= 1);
check('industries are recorded', status.industries.length >= 1);
check('real estate is represented', status.industries.some((i) => i.toLowerCase().includes('real estate')));

const ids = [...videoReferences(), ...imageReferences(), ...pageReferences()].map((r) => r.id);
check('every reference id is unique', new Set(ids).size === ids.length);

for (const ref of videoReferences()) {
  const m = ref.measured;
  check(`${ref.id}: proxy is a public https url`, /^https:\/\//.test(ref.assets.proxyUrl));
  check(`${ref.id}: contact sheet is a public https url`, /^https:\/\//.test(ref.assets.sheetUrl));
  check(`${ref.id}: duration was measured`, m.durationSec > 0);
  check(`${ref.id}: aspect matches pixel dimensions`, m.aspect === `${m.width}x${m.height}`);
  check(`${ref.id}: orientation agrees with dimensions`, m.orientation === (m.height > m.width ? 'vertical' : m.width > m.height ? 'horizontal' : 'square'));
  check(`${ref.id}: frame rate was measured`, m.fps > 0);
  check(`${ref.id}: shot list is non-empty`, m.shots.length >= 1);
  check(`${ref.id}: shot seconds sum to the duration`, Math.abs(m.shots.reduce((s, x) => s + x, 0) - m.durationSec) < 0.5);
  check(`${ref.id}: average shot length is consistent`, m.avgShotSec === null || Math.abs(m.avgShotSec - m.shots.reduce((s, x) => s + x, 0) / m.shots.length) < 0.05);
  check(`${ref.id}: has a summary the agent can choose on`, ref.summary.trim().length >= 40);
  check(`${ref.id}: summary carries no third-party brand claim`, !/(everline|riverton|copyright)/i.test(ref.summary));
}

console.log('\nmenu and brief');
const menu = referenceMenu('video', 'real estate');
check('menu lists the banked id', ids.every((id) => !videoReferences().some((r) => r.id === id) || menu.includes(id)));
check('menu states aspect and duration so the agent can choose', /vertical|horizontal|square/.test(menu) && /\ds/.test(menu));
check('menu for a kind with no references says so', referenceMenu('page').toLowerCase().includes('no page references'));
check('industry matching puts the matching reference first', referencesFor('video', 'real estate')[0]?.industry.toLowerCase().includes('real estate') ?? false);
check('an unknown industry still returns references', referencesFor('video', 'dentistry').length === videoReferences().length);

const chosen = videoReferences()[0];
const brief = referenceBrief(chosen);
check('brief carries the proxy url to watch', brief.includes(chosen.assets.proxyUrl));
check('brief carries the contact sheet', brief.includes(chosen.assets.sheetUrl));
check('brief names the measured length', brief.includes(String(chosen.measured.durationSec.toFixed(2))));
check('brief tells the agent to diff against the reference', brief.includes('hyperframes diff'));

console.log('\nmedia rules');
check(`the generated footage cap is ${GENERATED_FOOTAGE_CAP_SEC}s`, GENERATED_FOOTAGE_CAP_SEC === 30);
check(`a scene pack is ${SCENE_PACK_SEC}s`, SCENE_PACK_SEC === 15);
check('rules require using the business\'s own media first', MEDIA_RULES.some((r) => /own media/i.test(r)));
check('rules require animating a reference still rather than inventing a scene', MEDIA_RULES.some((r) => /animate that image/i.test(r)));
check('rules require representational media that does not read as AI', MEDIA_RULES.some((r) => /not as AI/i.test(r)));
check('rules cap generated footage', MEDIA_RULES.some((r) => r.includes(`${GENERATED_FOOTAGE_CAP_SEC} seconds`)));
check('rules forbid inventing product information', MEDIA_RULES.some((r) => /Never invent product information/i.test(r)));
check('rules make the reference the standard to compare against', MEDIA_RULES.some((r) => /compare your result against it/i.test(r)));
check('the prompt block numbers the rules', /^1\. /m.test(mediaRulesBlock()));

console.log('\nmedia selection');
const PRODUCT = 'prop-1';
const assets: TenantAsset[] = [
  { id: 'a1', url: 'https://cdn.test/p1.png', type: 'image', propertyId: PRODUCT, createdAt: '2026-01-01' },
  { id: 'a2', url: 'https://cdn.test/p2.png', type: 'image', propertyId: PRODUCT, createdAt: '2026-01-02' },
  { id: 'a3', url: 'https://cdn.test/p3.png', type: 'image', propertyId: PRODUCT, createdAt: '2026-01-03' },
  { id: 'a4', url: 'https://cdn.test/other.png', type: 'image', propertyId: null, createdAt: '2026-02-01' },
  { id: 'a5', url: 'http://insecure.test/x.png', type: 'image', propertyId: PRODUCT, createdAt: '2026-01-04' },
];

const linked = productAssets(assets, { propertyId: PRODUCT });
check('product-linked assets win over newer unlinked ones', linked.every((a) => a.propertyId === PRODUCT));
check('insecure urls are never selected', linked.every((a) => /^https:\/\//.test(a.url)));
check('selection respects the limit', productAssets(assets, { propertyId: PRODUCT, limit: 2 }).length === 2);
check('unlinked assets are used when nothing is linked', productAssets(assets, { propertyId: 'nope' }).length === 1);

const withStills = decideMediaPlan({ assets, propertyId: PRODUCT });
check('plenty of product stills -> use the tenant\'s own media', withStills.approach === 'tenant_product_assets');
check('nothing is generated when the tenant has media', withStills.generate.maxSeconds === 0);

const tiny = decideMediaPlan({ assets: [assets[0]], propertyId: PRODUCT, hasReferenceImage: true });
check('one still plus a reference image -> animate the still', tiny.approach === 'animate_reference_still');
check('the still is queued for animation', tiny.animate.length === 1);

const nothing = decideMediaPlan({ assets: [], propertyId: PRODUCT });
check('no media -> representational', nothing.approach === 'representational');
check('generated footage never exceeds the cap', nothing.generate.maxSeconds <= GENERATED_FOOTAGE_CAP_SEC);
check('at least one scene pack is generated', nothing.generate.maxSeconds >= SCENE_PACK_SEC);

const videoOnly = decideMediaPlan({
  assets: [{ id: 'v1', url: 'https://cdn.test/clip.mp4', type: 'video', propertyId: PRODUCT }],
  propertyId: PRODUCT,
});
check('an existing product clip alone is enough to skip generation', videoOnly.approach === 'tenant_product_assets' && videoOnly.generate.count === 0);

// A supabase stub that answers every query with an empty result, so the tool logic runs for real.
const emptyResult = { data: [], error: null };
const chain: any = new Proxy(function () {}, {
  get: (_t, prop) => {
    if (prop === 'then') return (resolve: any) => Promise.resolve(emptyResult).then(resolve);
    return () => chain;
  },
  apply: () => chain,
});

console.log('\nagent tools');
const tools = createReferenceBankTools(chain, 'tenant-test') as any;
check('list_reference_bank is registered', typeof tools.list_reference_bank?.execute === 'function');
check('use_reference is registered', typeof tools.use_reference?.execute === 'function');

const listed = await tools.list_reference_bank.execute({ kind: 'video', industry: 'real estate' }, {} as any);
check('listing returns the banked video', String(listed.menu).includes(chosen.id));
check('listing carries the summary so the agent can choose', String(listed.menu).includes(chosen.summary.slice(0, 40)));
check('listing hands back the media rules', String(listed.rules).includes('Never invent product information'));
check('listing tells the agent the next move', String(listed.next).includes('use_reference'));

const emptyKind = await tools.list_reference_bank.execute({ kind: 'page' }, {} as any);
check('an empty shelf says the bank is empty rather than pretending', String(emptyKind.menu).toLowerCase().includes('no page references'));

const unknown = await tools.use_reference.execute({ kind: 'video', id: 'does-not-exist' }, {} as any);
check('an unknown id fails with the menu instead of throwing', unknown.success === false && String(unknown.menu).includes(chosen.id));

const used = await tools.use_reference.execute({ kind: 'video', id: chosen.id }, {} as any);
check('using a real reference returns its brief', used.success === true && String(used.brief).includes(chosen.assets.proxyUrl));
check('using a real reference returns a media plan', !!used.mediaPlan?.approach);
check('with no tenant media the plan generates representational footage', used.mediaPlan.approach === 'representational');
check('that generated footage is capped', used.mediaPlan.generate.maxSeconds <= GENERATED_FOOTAGE_CAP_SEC);
check('the rules travel with the reference', String(used.rules).includes(`${GENERATED_FOOTAGE_CAP_SEC} seconds`));
check('the agent is told to compare before delivering', String(used.beforeDelivering).includes('compare'));

console.log(`\n${'='.repeat(64)}`);
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);