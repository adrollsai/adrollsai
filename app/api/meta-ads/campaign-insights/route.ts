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

        // Fetch aggregate insights, daily breakdown, ads list, campaign metadata, and ad-level insights in parallel
        const [summaryRes, dailyRes, adsRes, adInsightsRes, campMetaRes] = await Promise.all([
            fetch(`${FB_GRAPH_URL}/${campaignId}/insights?fields=spend,impressions,clicks,actions,ctr,cpc,cpm,inline_link_click_ctr&${dateParam}&access_token=${token}`).then(r => r.json()),
            fetch(`${FB_GRAPH_URL}/${campaignId}/insights?fields=spend,impressions,clicks,actions,ctr,cpc,cpm,inline_link_click_ctr&time_increment=1&${dateParam}&access_token=${token}`).then(r => r.json()),
            fetch(`${FB_GRAPH_URL}/${campaignId}/ads?fields=id,name,creative{id,name,image_url,thumbnail_url,object_story_spec,call_to_action}&access_token=${token}`).then(r => r.json()),
            fetch(`${FB_GRAPH_URL}/${campaignId}/insights?level=ad&fields=ad_id,ad_name,spend,impressions,clicks,actions,ctr,cpc,cpm,inline_link_click_ctr&${dateParam}&access_token=${token}`).then(r => r.json()),
            fetch(`${FB_GRAPH_URL}/${campaignId}?fields=id,name,objective&access_token=${token}`).then(r => r.json()).catch(() => ({}))
        ])

        if (summaryRes.error) {
            console.error("Meta Campaign Aggregate Insights Error:", summaryRes.error);
            return NextResponse.json({ error: summaryRes.error.message }, { status: 400 });
        }

        const adsData = adsRes.data || [];
        const adInsightsData = adInsightsRes.data || [];
        const summaryActions = summaryRes.data?.[0]?.actions || [];

        // 1. Detect if this is a WhatsApp / Click-to-Chat campaign
        let hasWhatsAppCta = false;
        let attachedLeadGenFormId: string | null = null;

        for (const ad of adsData) {
            const cta = ad.creative?.call_to_action;
            if (cta?.type === 'WHATSAPP_MESSAGE' || cta?.value?.app_destination === 'WHATSAPP') {
                hasWhatsAppCta = true;
            }
            if (cta?.value?.lead_gen_form_id) {
                attachedLeadGenFormId = cta.value.lead_gen_form_id;
            }
            const storySpecCta = ad.creative?.object_story_spec?.link_data?.call_to_action;
            if (storySpecCta?.type === 'WHATSAPP_MESSAGE' || storySpecCta?.value?.app_destination === 'WHATSAPP') {
                hasWhatsAppCta = true;
            }
        }

        const waConnAction = summaryActions.find((a: any) => 
            a.action_type === 'onsite_conversion.total_messaging_connection' ||
            a.action_type === 'onsite_conversion.messaging_conversation_started_7d' ||
            a.action_type === 'messaging_conversation_started_7d'
        );
        const waConnCount = waConnAction ? parseInt(waConnAction.value || '0', 10) : 0;

        const isWhatsApp = hasWhatsAppCta || 
                           campMetaRes?.objective === 'MESSAGES' || 
                           (!attachedLeadGenFormId && waConnCount > 0);

        const resultType = isWhatsApp ? 'whatsapp' : 'lead_form';

        const parseActions = (actions: any[]) => {
            if (!actions || !Array.isArray(actions)) {
                return { leads: 0, clicks: 0, landingPageViews: 0 };
            }

            let leads = 0;
            if (isWhatsApp) {
                // For WhatsApp campaigns: only actual initiated messaging conversations
                const wa = actions.find((a: any) => 
                    a.action_type === 'onsite_conversion.total_messaging_connection' ||
                    a.action_type === 'onsite_conversion.messaging_conversation_started_7d' ||
                    a.action_type === 'messaging_conversation_started_7d' ||
                    a.action_type === 'onsite_conversion.messaging_first_reply'
                );
                leads = wa ? parseInt(wa.value || '0', 10) : 0;
            } else {
                // For Form campaigns: onsite form submissions action (leadgen.other or onsite_conversion.lead_gen)
                const onsiteFormAction = actions.find((a: any) => 
                    a.action_type === 'leadgen.other' || 
                    a.action_type === 'onsite_conversion.lead_gen'
                );
                leads = onsiteFormAction ? parseInt(onsiteFormAction.value || '0', 10) : 0;
            }

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

        // 2. For Lead Form campaigns, ensure actual lead form submissions are accurately reflected
        if (!isWhatsApp) {
            let leadsQuery = supabase
                .from('leads')
                .select('id, ad_name, created_at, custom_fields')
                .eq('user_id', targetUserId)
                .or(`campaign_id.eq.${campaignId},custom_fields->meta_ad_origin->>campaign_id.eq.${campaignId}`);

            if (since && until) {
                leadsQuery = leadsQuery
                    .gte('created_at', new Date(since).toISOString())
                    .lte('created_at', new Date(until + 'T23:59:59.999Z').toISOString());
            } else if (datePreset === 'today') {
                const start = new Date(); start.setHours(0, 0, 0, 0);
                leadsQuery = leadsQuery.gte('created_at', start.toISOString());
            } else if (datePreset === 'yesterday') {
                const start = new Date(); start.setDate(start.getDate() - 1); start.setHours(0, 0, 0, 0);
                const end = new Date(); end.setDate(end.getDate() - 1); end.setHours(23, 59, 59, 999);
                leadsQuery = leadsQuery.gte('created_at', start.toISOString()).lte('created_at', end.toISOString());
            } else if (datePreset === 'last_7d') {
                const d = new Date(); d.setDate(d.getDate() - 7);
                leadsQuery = leadsQuery.gte('created_at', d.toISOString());
            } else if (datePreset === 'last_30d') {
                const d = new Date(); d.setDate(d.getDate() - 30);
                leadsQuery = leadsQuery.gte('created_at', d.toISOString());
            }

            const { data: dbLeads } = await leadsQuery;
            const actualFormLeads = dbLeads || [];

            if (actualFormLeads.length > 0) {
                summary.leads = actualFormLeads.length;

                // Daily breakdown mapping
                const leadsByDay: Record<string, number> = {};
                actualFormLeads.forEach(l => {
                    if (l.created_at) {
                        const dayStr = l.created_at.slice(0, 10);
                        leadsByDay[dayStr] = (leadsByDay[dayStr] || 0) + 1;
                    }
                });
                dailyBreakdown.forEach((day: any) => {
                    day.leads = leadsByDay[day.date] || 0;
                });

                // Creative insights mapping
                creativeInsights.forEach((ci: any) => {
                    const matchCount = actualFormLeads.filter(l => {
                        if (l.custom_fields?.meta_ad_origin?.ad_id === ci.adId) return true;
                        if (l.ad_name && ci.adName && (
                            l.ad_name.toLowerCase().includes(ci.adName.toLowerCase()) || 
                            ci.adName.toLowerCase().includes(l.ad_name.toLowerCase())
                        )) return true;
                        return false;
                    }).length;
                    ci.leads = matchCount;
                });
            } else if (attachedLeadGenFormId && summary.leads === 0) {
                // Fallback to query form leads_count directly if DB hasn't synced
                try {
                    const formRes = await fetch(`${FB_GRAPH_URL}/${attachedLeadGenFormId}?fields=leads_count&access_token=${token}`);
                    const formData = await formRes.json();
                    if (formData.leads_count !== undefined) {
                        summary.leads = formData.leads_count;
                    }
                } catch (e) {}
            }
        }

        return NextResponse.json({
            success: true,
            resultType,
            summary,
            dailyBreakdown,
            creativeInsights
        });

    } catch (error: any) {
        console.error("[Campaign Insights API] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}