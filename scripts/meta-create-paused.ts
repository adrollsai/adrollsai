/**
 * Create a Meta campaign + ad set + ad, PAUSED at every level, and prove it is paused afterwards.
 *
 * The owner asked for a real ad launched and then paused in Ads Manager. The safe way to honour
 * that is to create it with status=PAUSED from the first call, so it can never spend a rupee, and
 * then read it back from the API to confirm what Meta actually holds.
 *
 * Nothing here sets ACTIVE. If Meta reports anything other than PAUSED the run fails loudly.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local', quiet: true });
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const { data: profile } = await admin
  .from('profiles')
  .select('ad_account_id, selected_page_id, selected_page_name, facebook_token, business_name')
  .eq('email', 'rchopra489@gmail.com')
  .maybeSingle();
if (!profile?.facebook_token || !profile.ad_account_id) {
  console.error('no Meta token / ad account on the profile');
  process.exit(1);
}

const V = 'https://graph.facebook.com/v20.0';
const TOKEN = String(profile.facebook_token);
const ACCOUNT = String(profile.ad_account_id);
const PAGE = String(profile.selected_page_id);

const post = async (path: string, body: Record<string, unknown>) => {
  const res = await fetch(`${V}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, access_token: TOKEN }),
  });
  const json: any = await res.json().catch(() => ({}));
  return { ok: res.ok && !json?.error, json, status: res.status };
};
const get = async (path: string, fields: string) => {
  const res = await fetch(`${V}/${path}?fields=${fields}&access_token=${TOKEN}`);
  return (await res.json().catch(() => ({}))) as any;
};

const LINK = 'https://app.pipixel.io/shared/bc63c065-9bcc-4793-bedc-f0960406425b/nobogent-ai-run-your-business';
const stamp = Date.now().toString().slice(-6);

console.log(`account: ${ACCOUNT} · page: ${PAGE} (${profile.selected_page_name})`);

// 1. campaign — PAUSED
const campaign = await post(`${ACCOUNT}/campaigns`, {
  name: `Nobogent · AI Marketing Dept · paused test ${stamp}`,
  objective: 'OUTCOME_TRAFFIC',
  status: 'PAUSED',
  special_ad_categories: [],
  buying_type: 'AUCTION',
  // Meta requires this explicitly on modern accounts; campaign-level budget sharing off.
  is_adset_budget_sharing_enabled: false,
});
console.log('\ncampaign:', campaign.ok ? campaign.json.id : JSON.stringify(campaign.json).slice(0, 300));
if (!campaign.ok) process.exit(1);
const campaignId = campaign.json.id;

// 2. ad set — PAUSED, tiny budget so even a mistake is cheap
const adset = await post(`${ACCOUNT}/adsets`, {
  name: `Nobogent · India 25-55 · paused test ${stamp}`,
  campaign_id: campaignId,
  status: 'PAUSED',
  daily_budget: 50000, // ₹500/day in paise
  billing_event: 'IMPRESSIONS',
  optimization_goal: 'LINK_CLICKS',
  bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
  targeting: {
    geo_locations: { countries: ['IN'] },
    age_min: 25,
    age_max: 55,
    publisher_platforms: ['facebook', 'instagram'],
    // Modern Meta requires an explicit decision on Advantage audience expansion.
    targeting_automation: { advantage_audience: 0 },
  },
});
console.log('adset  :', adset.ok ? adset.json.id : JSON.stringify(adset.json).slice(0, 300));
if (!adset.ok) {
  console.log('\nStopping: the ad set could not be created, so nothing is live.');
  process.exitCode = 1;
} else {
  const adsetId = adset.json.id;

  // 3. ad — PAUSED
  const ad = await post(`${ACCOUNT}/ads`, {
    name: `Nobogent · AI marketing dept · paused test ${stamp}`,
    adset_id: adsetId,
    status: 'PAUSED',
    creative: {
      object_story_spec: {
        page_id: PAGE,
        link_data: {
          link: LINK,
          message:
            'Your entire marketing department, run by AI. Creatives, ads, WhatsApp follow-ups and ' +
            'a daily report — one place, no agency.',
          name: 'Nobogent — your AI marketing department',
          description: 'Built for Indian SMBs. Start in minutes.',
          call_to_action: { type: 'LEARN_MORE' },
        },
      },
    },
  });
  console.log('ad     :', ad.ok ? ad.json.id : JSON.stringify(ad.json).slice(0, 400));

  // 4. read back the truth
  for (const [label, id] of [
    ['campaign', campaignId],
    ['adset', adsetId],
    ['ad', ad.ok ? ad.json.id : null],
  ] as const) {
    if (!id) continue;
    const state = await get(id, 'name,status,effective_status');
    const paused = state.effective_status === 'PAUSED';
    console.log(
      `${label.padEnd(8)} status=${state.status} effective=${state.effective_status} ` +
        `${paused ? '✔ cannot spend' : '✖ NOT PAUSED'}`,
    );
    if (!paused) process.exitCode = 1;
  }
  console.log(`\nreview it: https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${ACCOUNT.replace('act_', '')}`);
}
