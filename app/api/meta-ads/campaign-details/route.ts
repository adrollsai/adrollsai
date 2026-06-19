import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

const FB_GRAPH_URL = "https://graph.facebook.com/v19.0"

export async function GET(request: Request) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const impersonateId = url.searchParams.get('impersonate')
  const campaignId = url.searchParams.get('campaignId')

  if (!campaignId) {
    return NextResponse.json({ error: 'Campaign ID is required' }, { status: 400 })
  }

  const { data: profile } = await supabase.from('profiles').select('role, facebook_token, agency_id, parent_id').eq('id', user.id).single()
  
  let targetUserId = (['admin', 'agent'].includes(profile?.role || '') && (profile?.agency_id || profile?.parent_id)) 
    ? (profile.agency_id || profile.parent_id) 
    : user.id

  if (impersonateId) {
      if (['super_admin', 'agency', 'admin'].includes(profile?.role || '')) {
          if (profile?.role !== 'super_admin') {
              const isParent = (profile?.agency_id === impersonateId || profile?.parent_id === impersonateId);
              const { data: subAccount } = await supabase
                .from('profiles')
                .select('id')
                .eq('id', impersonateId)
                .eq('agency_id', profile?.agency_id || user.id)
                .single()

              if (isParent || subAccount) {
                  targetUserId = impersonateId
              } else {
                  return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 })
              }
          } else {
              targetUserId = impersonateId
          }
      } else {
          return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 })
      }
  }

  const { data: targetProfile } = await supabase
    .from('profiles')
    .select('facebook_token, agency_id, parent_id')
    .eq('id', targetUserId)
    .single()

  let token = targetProfile?.facebook_token
  if (!token) {
      token = profile?.facebook_token
  }

  if (!token && (profile?.agency_id || profile?.parent_id)) {
      const { data: parentProfile } = await supabase
          .from('profiles')
          .select('facebook_token')
          .eq('id', profile.agency_id || profile.parent_id)
          .single()
      token = parentProfile?.facebook_token
  }

  if (!token) {
    return NextResponse.json({ error: 'Meta Ad Account not fully connected.' }, { status: 400 })
  }

  try {
    // Nested Graph API call: Fetch Campaign, its Ad Sets, its Ads, and dynamic insights (delivery stats) for each
    const fields = 'id,name,status,daily_budget,lifetime_budget,budget_remaining,insights{spend,impressions,clicks,actions},adsets{id,name,status,daily_budget,lifetime_budget,insights{spend,impressions,clicks,actions},optimization_goal,billing_event,targeting},ads{id,name,status,adset_id,creative{id,name,image_url,thumbnail_url,object_story_spec},insights{spend,impressions,clicks,actions}}';
    const fbUrl = `${FB_GRAPH_URL}/${campaignId}?fields=${fields}&date_preset=maximum&access_token=${token}`;

    const response = await fetch(fbUrl);
    const data = await response.json();

    if (data.error) {
      console.error("Meta Campaign Details Error:", data.error);
      throw new Error(data.error.message);
    }

    // Helper: Parse delivery insights safely
    const parseInsights = (insightsObj: any) => {
      const insight = insightsObj?.data?.[0];
      if (!insight) {
        return { spend: 0, impressions: 0, clicks: 0, leads: 0, ctr: 0, cpc: 0, cpl: 0 };
      }
      const spend = parseFloat(insight.spend || '0');
      const impressions = parseInt(insight.impressions || '0', 10);
      const clicks = parseInt(insight.clicks || '0', 10);
      const leads = parseInt(insight.actions?.find((a: any) => a.action_type === 'lead')?.value || '0', 10);

      const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
      const cpc = clicks > 0 ? spend / clicks : 0;
      const cpl = leads > 0 ? spend / leads : 0;

      return { spend, impressions, clicks, leads, ctr, cpc, cpl };
    };

    const campaignMetrics = parseInsights(data.insights);
    const adsetsRaw = data.adsets?.data || [];
    const adsRaw = data.ads?.data || [];

    // Collect video IDs that need source URL resolution
    const videoIds: string[] = [];
    for (const ad of adsRaw) {
      const videoId = ad.creative?.object_story_spec?.video_data?.video_id;
      if (videoId) videoIds.push(videoId);
    }

    // Batch-fetch video source URLs from Meta
    const videoSourceMap: Record<string, string> = {};
    for (const vid of videoIds) {
      try {
        const vidRes = await fetch(`${FB_GRAPH_URL}/${vid}?fields=source&access_token=${token}`);
        const vidData = await vidRes.json();
        if (vidData.source) {
          videoSourceMap[vid] = vidData.source;
        }
      } catch (e) {
        console.error(`Failed to fetch video source for ${vid}:`, e);
      }
    }

    // Parse and augment Ad Sets
    const adsets = adsetsRaw.map((adset: any) => {
      const metrics = parseInsights(adset.insights);
      // Budget can be in daily_budget or lifetime_budget
      const budgetRaw = adset.daily_budget || adset.lifetime_budget || 0;
      const budgetType = adset.daily_budget ? 'daily' : adset.lifetime_budget ? 'lifetime' : 'none';
      
      return {
        id: adset.id,
        name: adset.name,
        status: adset.status,
        budget: parseFloat(budgetRaw) / 100, // standard display format
        budgetType,
        optimization_goal: adset.optimization_goal,
        billing_event: adset.billing_event,
        metrics,
        targeting: adset.targeting || {},
        ads: [] as any[]
      };
    });

    // Parse Ads and associate them with Ad Sets
    const ads = adsRaw.map((ad: any) => {
      const metrics = parseInsights(ad.insights);
      const storySpec = ad.creative?.object_story_spec || {};
      const linkData = storySpec.link_data || {};
      const videoData = storySpec.video_data || {};
      const isVideoAd = !!videoData.video_id;

      const imageHash = linkData.image_hash || videoData.image_hash || '';
      
      // For video ads, resolve the actual video source URL
      const videoId = videoData.video_id || '';
      const videoSourceUrl = videoId ? (videoSourceMap[videoId] || '') : '';
      
      // imageUrl: for video ads use the video source, for image ads use the image
      const imageUrl = isVideoAd 
        ? (videoSourceUrl || ad.creative?.image_url || ad.creative?.thumbnail_url || '')
        : (ad.creative?.image_url || ad.creative?.thumbnail_url || linkData.picture || '');
      
      // Extract copy from either link_data or video_data
      const primaryText = linkData.message || videoData.message || '';
      const headline = linkData.name || videoData.title || '';
      const description = linkData.description || videoData.link_description || '';
      const linkUrl = linkData.link || videoData.call_to_action?.value?.link || linkData.call_to_action?.value?.link || '';
      const leadFormId = linkData.call_to_action?.value?.lead_gen_form_id || videoData.call_to_action?.value?.lead_gen_form_id || '';
      const pageId = storySpec.page_id || '';

      return {
        id: ad.id,
        name: ad.name,
        status: ad.status,
        adset_id: ad.adset_id,
        metrics,
        creative: {
          id: ad.creative?.id || '',
          imageHash,
          imageUrl,
          videoSourceUrl,
          isVideo: isVideoAd,
          primaryText,
          headline,
          description,
          linkUrl,
          leadFormId,
          pageId
        }
      };
    });

    // Group Ads under their parent Ad Sets
    ads.forEach((ad: any) => {
      const parentAdset = adsets.find((as: any) => as.id === ad.adset_id);
      if (parentAdset) {
        parentAdset.ads.push(ad);
      }
    });

    const budgetRaw = data.daily_budget || data.lifetime_budget || 0;
    const budgetType = data.daily_budget ? 'daily' : data.lifetime_budget ? 'lifetime' : 'none';

    return NextResponse.json({
      success: true,
      campaign: {
        id: data.id,
        name: data.name,
        status: data.status,
        budget: parseFloat(budgetRaw) / 100,
        budgetType,
        metrics: campaignMetrics,
      },
      adsets
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
