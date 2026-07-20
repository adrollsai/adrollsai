import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

const FB_GRAPH_URL = "https://graph.facebook.com/v19.0"

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url)
        const campaignId = searchParams.get('campaignId')
        const datePreset = searchParams.get('datePreset') || 'maximum'
        const since = searchParams.get('since')
        const until = searchParams.get('until')
        
        const supabase = await createClient()

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        if (!campaignId) return NextResponse.json({ error: 'Campaign ID is required' }, { status: 400 })

        const impersonateId = searchParams.get('impersonate')
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

        if (!token) return NextResponse.json({ error: 'Meta Ad Account not fully connected.' }, { status: 400 })

        let dateParam = ''
        if (since && until) {
            dateParam = `time_range=${encodeURIComponent(JSON.stringify({ since, until }))}`
        } else {
            dateParam = `date_preset=${datePreset}`
        }

        // Fetch aggregate insights, daily breakdown, ads list, and ad-level insights in parallel
        const [summaryRes, dailyRes, adsRes, adInsightsRes] = await Promise.all([
            fetch(`${FB_GRAPH_URL}/${campaignId}/insights?fields=spend,impressions,clicks,actions,ctr,cpc,cpm,inline_link_click_ctr&${dateParam}&access_token=${token}`).then(r => r.json()),
            fetch(`${FB_GRAPH_URL}/${campaignId}/insights?fields=spend,impressions,clicks,actions,ctr,cpc,cpm,inline_link_click_ctr&time_increment=1&${dateParam}&access_token=${token}`).then(r => r.json()),
            fetch(`${FB_GRAPH_URL}/${campaignId}/ads?fields=id,name,creative{id,name,image_url,thumbnail_url,object_story_spec}&access_token=${token}`).then(r => r.json()),
            fetch(`${FB_GRAPH_URL}/${campaignId}/insights?level=ad&fields=ad_id,ad_name,spend,impressions,clicks,actions,ctr,cpc,cpm,inline_link_click_ctr&${dateParam}&access_token=${token}`).then(r => r.json())
        ])

        if (summaryRes.error) {
            console.error("Meta Campaign Aggregate Insights Error:", summaryRes.error);
            return NextResponse.json({ error: summaryRes.error.message }, { status: 400 });
        }

        const parseActions = (actions: any[]) => {
            if (!actions || !Array.isArray(actions)) {
                return { leads: 0, clicks: 0, landingPageViews: 0 };
            }
            const waAction = actions.find((a: any) => 
                a.action_type === 'onsite_conversion.messaging_conversation_started_7d' ||
                a.action_type === 'messaging_conversation_started_7d' ||
                a.action_type === 'onsite_conversion.messaging_first_reply' ||
                a.action_type === 'messaging_user_depth_2_message_send'
            );
            const leadAction = actions.find((a: any) => a.action_type === 'lead');
            const leadGroupedAction = actions.find((a: any) => a.action_type === 'onsite_conversion.lead_grouped');
            const leads = waAction 
                ? parseInt(waAction.value || '0', 10) 
                : (leadAction ? parseInt(leadAction.value || '0', 10) : (leadGroupedAction ? parseInt(leadGroupedAction.value || '0', 10) : 0));

            const clicks = actions
                .filter((a: any) => a.action_type === 'link_click')
                .reduce((sum: number, a: any) => sum + parseInt(a.value || '0', 10), 0);
            const landingPageViews = actions
                .filter((a: any) => a.action_type === 'landing_page_view')
                .reduce((sum: number, a: any) => sum + parseInt(a.value || '0', 10), 0);
            return { leads, clicks, landingPageViews };
        };

        const parseSingleInsight = (insight: any) => {
            if (!insight) {
                return {
                    spend: 0,
                    impressions: 0,
                    clicks: 0,
                    ctr: 0,
                    cpc: 0,
                    cpm: 0,
                    inlineLinkClickCtr: 0,
                    leads: 0,
                    linkClicks: 0,
                    landingPageViews: 0
                };
            }
            const spend = parseFloat(insight.spend || '0');
            const impressions = parseInt(insight.impressions || '0', 10);
            const clicks = parseInt(insight.clicks || '0', 10);
            const ctr = parseFloat(insight.ctr || '0');
            const cpc = parseFloat(insight.cpc || '0');
            const cpm = parseFloat(insight.cpm || '0');
            const inlineLinkClickCtr = parseFloat(insight.inline_link_click_ctr || '0');
            
            const { leads, clicks: linkClicks, landingPageViews } = parseActions(insight.actions);

            return {
                spend,
                impressions,
                clicks,
                ctr,
                cpc,
                cpm,
                inlineLinkClickCtr,
                leads,
                linkClicks,
                landingPageViews
            };
        };

        const summary = parseSingleInsight(summaryRes.data?.[0]);
        const dailyBreakdown = (dailyRes.data || []).map((day: any) => {
            return {
                date: day.date_start,
                ...parseSingleInsight(day)
            };
        }).sort((a: any, b: any) => a.date.localeCompare(b.date));

        const adsData = adsRes.data || [];
        const adInsightsData = adInsightsRes.data || [];

        const creativeInsights = adInsightsData.map((adInsight: any) => {
            const metrics = parseSingleInsight(adInsight);
            const matchingAd = adsData.find((a: any) => a.id === adInsight.ad_id);
            const storySpec = matchingAd?.creative?.object_story_spec || {};
            const linkData = storySpec.link_data || {};
            const thumbnail = matchingAd?.creative?.thumbnail_url || matchingAd?.creative?.image_url || linkData.picture || '';

            return {
                adId: adInsight.ad_id,
                adName: adInsight.ad_name,
                thumbnail,
                ...metrics
            };
        });

        // Add ads that have no insights yet to creativeInsights so they still show up with 0s
        adsData.forEach((ad: any) => {
            const hasInsights = creativeInsights.some((ci: any) => ci.adId === ad.id);
            if (!hasInsights) {
                const storySpec = ad.creative?.object_story_spec || {};
                const linkData = storySpec.link_data || {};
                const thumbnail = ad.creative?.thumbnail_url || ad.creative?.image_url || linkData.picture || '';
                creativeInsights.push({
                    adId: ad.id,
                    adName: ad.name,
                    thumbnail,
                    spend: 0,
                    impressions: 0,
                    clicks: 0,
                    ctr: 0,
                    cpc: 0,
                    cpm: 0,
                    inlineLinkClickCtr: 0,
                    leads: 0,
                    linkClicks: 0,
                    landingPageViews: 0
                });
            }
        });

        return NextResponse.json({
            success: true,
            summary,
            dailyBreakdown,
            creativeInsights
        });

    } catch (error: any) {
        console.error("[Campaign Insights API] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}