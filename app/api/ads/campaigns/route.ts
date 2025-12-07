import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { user } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [userData] = await db.select().from(user).where(eq(user.id, session.user.id)).limit(1);

  if (!userData?.adAccountId || !userData?.facebookToken) {
    return NextResponse.json({ error: "Ad Account or Token missing" }, { status: 400 });
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/act_${userData.adAccountId}/campaigns?fields=id,name,status,objective,start_time,stop_time,insights{impressions,clicks,spend,cpc,ctr}&access_token=${userData.facebookToken}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch campaigns" }, { status: 500 });
  }
}

export async function POST(request: Request) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const [userData] = await db.select().from(user).where(eq(user.id, session.user.id)).limit(1);

    if (!userData?.adAccountId || !userData?.facebookToken) {
        return NextResponse.json({ error: "Ad Account or Token missing" }, { status: 400 });
    }

    const body = await request.json();
    const {
        name,
        objective = "OUTCOME_TRAFFIC",
        status = "PAUSED",
        daily_budget,
        bid_amount,
        billing_event = "IMPRESSIONS",
        optimization_goal = "LINK_CLICKS",
        targeting,
        creative
    } = body;

    const accessToken = userData.facebookToken;
    const accountId = userData.adAccountId;

    try {
        // 1. Create Campaign
        const campaignRes = await fetch(`https://graph.facebook.com/v21.0/act_${accountId}/campaigns`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name,
                objective: objective,
                status: status,
                special_ad_categories: [], // Assuming no special categories for now, but should be handled
                access_token: accessToken
            })
        });
        const campaignData = await campaignRes.json();
        if (campaignData.error) throw new Error(`Campaign Error: ${JSON.stringify(campaignData.error)}`);

        const campaignId = campaignData.id;

        // 2. Create Ad Set
        // Note: daily_budget is in cents
        const adSetRes = await fetch(`https://graph.facebook.com/v21.0/act_${accountId}/adsets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: `${name} - Ad Set`,
                campaign_id: campaignId,
                daily_budget: daily_budget, // e.g. 1000 = $10.00
                billing_event: billing_event,
                optimization_goal: optimization_goal,
                bid_amount: bid_amount, // Optional
                targeting: targeting, // e.g. { "geo_locations": { "countries": ["US"] } }
                status: status,
                access_token: accessToken
            })
        });
        const adSetData = await adSetRes.json();
        if (adSetData.error) throw new Error(`AdSet Error: ${JSON.stringify(adSetData.error)}`);

        const adSetId = adSetData.id;

        // 3. Create Ad Creative (Simplified: Using existing post or image hash)
        // If 'creative' has object_story_id (existing post) or image_hash

        let creativeId = creative.creative_id; // If reusing existing creative

        if (!creativeId) {
            const creativeRes = await fetch(`https://graph.facebook.com/v21.0/act_${accountId}/adcreatives`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: `${name} - Creative`,
                    object_story_spec: creative.object_story_spec, // { "page_id": "...", "instagram_actor_id": "...", "link_data": { ... } }
                    access_token: accessToken
                })
            });
            const creativeData = await creativeRes.json();
            if (creativeData.error) throw new Error(`Creative Error: ${JSON.stringify(creativeData.error)}`);
            creativeId = creativeData.id;
        }

        // 4. Create Ad
        const adRes = await fetch(`https://graph.facebook.com/v21.0/act_${accountId}/ads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: `${name} - Ad`,
                adset_id: adSetId,
                creative: { creative_id: creativeId },
                status: status,
                access_token: accessToken
            })
        });
        const adData = await adRes.json();
        if (adData.error) throw new Error(JSON.stringify(adData.error));

        return NextResponse.json({
            success: true,
            campaign_id: campaignId,
            adset_id: adSetId,
            ad_id: adData.id
        });

    } catch (error: any) {
        console.error("Ads Creation Error:", error);
        return NextResponse.json({ error: error.message || "Failed to create ad" }, { status: 500 });
    }
}
