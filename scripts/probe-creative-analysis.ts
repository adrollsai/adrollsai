/**
 * Runs the Optimize analysis against the live Meta account, using the same fields the route asks
 * for, and prints what the owner would see. Read-only: it fetches insights and judges them.
 *
 *   npx tsx scripts/probe-creative-analysis.ts [campaignId]
 */
import { createClient } from '@supabase/supabase-js';
import { analyseCreatives } from '../lib/ads/creative-performance';
import { META_GRAPH_URL } from '../lib/ads/graph-version';

const OWNER = 'bc63c065-9bcc-4793-bedc-f0960406425b';
const GRAPH = META_GRAPH_URL;

(async () => {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: profile } = await db.from('profiles').select('*').eq('id', OWNER).single();
  const token = (profile as any)?.facebook_token;
  const adAccountId = (profile as any)?.ad_account_id || (profile as any)?.facebook_ad_account_id;
  if (!token || !adAccountId) {
    console.log('no facebook token / ad account on the owner profile:', Boolean(token), adAccountId);
    return;
  }
  console.log('ad account:', adAccountId);

  let campaignId = process.argv[2];
  if (!campaignId) {
    // The campaign with the most delivery in the window — the one an owner would click Optimize on.
    const res = await fetch(
      `${GRAPH}/${adAccountId}/insights?fields=campaign_id,campaign_name,spend&level=campaign&date_preset=last_30d&limit=50&access_token=${token}`
    );
    const json: any = await res.json();
    if (!json?.data?.length) {
      console.log('no campaign delivery in the last 30 days:', JSON.stringify(json).slice(0, 300));
      return;
    }
    const best = [...json.data].sort((a: any, b: any) => Number(b.spend) - Number(a.spend))[0];
    campaignId = best.campaign_id;
    console.log(`campaign: ${best.campaign_name} (${campaignId}) spend ₹${best.spend}`);
  }

  const fields = 'ad_id,ad_name,spend,impressions,clicks,ctr,cpc,reach,frequency,actions,cost_per_action_type';
  const insightsRes = await fetch(
    `${GRAPH}/${campaignId}/insights?fields=${fields}&level=ad&date_preset=last_30d&access_token=${token}`
  );
  const insights: any = await insightsRes.json();
  if (!insights?.data?.length) {
    console.log('no ad-level delivery for this campaign in the last 30 days');
    return;
  }

  const analysis = analyseCreatives(insights.data, { window: 'the last 30 days' });
  console.log(`\n${analysis.summary}\n`);
  console.log('verdict'.padEnd(10), 'spend'.padStart(9), 'enq'.padStart(5), 'ctr'.padStart(7), '  creative');
  for (const creative of analysis.creatives) {
    console.log(
      creative.verdict.padEnd(10),
      `₹${(creative.spendPaise / 100).toLocaleString('en-IN')}`.padStart(9),
      String(creative.results).padStart(5),
      `${creative.ctrPct === null ? '-' : creative.ctrPct.toFixed(2) + '%'}`.padStart(7),
      ' ',
      creative.adName.slice(0, 60)
    );
  }
  console.log(
    `\nbaseline ₹${(analysis.baselineCostPerResultPaise ?? 0) / 100} per enquiry · comparable ${analysis.comparable} · ` +
      `judged ${analysis.totals.judged} · too early ${analysis.totals.unjudged}`
  );
})();
