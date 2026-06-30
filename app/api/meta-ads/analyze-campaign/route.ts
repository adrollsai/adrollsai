import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { callGemini } from '@/utils/external-apis'
import { createClient as createAdminClient } from '@supabase/supabase-js'

const FB_GRAPH_URL = "https://graph.facebook.com/v19.0"

// Admin client to bypass RLS when performing service tasks
const getAdminClient = () => {
    return createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
}

// Helper to resolve target user and meta token
async function resolveCredentials(supabase: any, impersonateId: string | null) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data: profile } = await supabase
        .from('profiles')
        .select('role, facebook_token, ad_account_id, agency_id, parent_id')
        .eq('id', user.id)
        .single()

    let targetUserId = (['admin', 'agent'].includes(profile?.role || '') && (profile?.agency_id || profile?.parent_id))
        ? (profile.agency_id || profile.parent_id)
        : user.id

    if (impersonateId) {
        if (['super_admin', 'agency', 'admin'].includes(profile?.role || '')) {
            if (profile?.role !== 'super_admin') {
                const isParent = (profile?.agency_id === impersonateId || profile?.parent_id === impersonateId)
                const { data: subAccount } = await supabase
                    .from('profiles')
                    .select('id')
                    .eq('id', impersonateId)
                    .eq('agency_id', profile?.agency_id || user.id)
                    .single()

                if (isParent || subAccount) {
                    targetUserId = impersonateId
                }
            } else {
                targetUserId = impersonateId
            }
        }
    }

    const { data: targetProfile } = await getAdminClient()
        .from('profiles')
        .select('facebook_token, ad_account_id, selected_page_token, selected_page_id, business_name, currency')
        .eq('id', targetUserId)
        .single()

    const token = targetProfile?.facebook_token || profile?.facebook_token || null
    return {
        userId: user.id,
        targetUserId,
        token,
        adAccountId: targetProfile?.ad_account_id || null,
        pageId: targetProfile?.selected_page_id || null,
        businessName: targetProfile?.business_name || 'Our Business',
        currency: targetProfile?.currency || 'INR'
    }
}

// GET: Retrieve past analyses for this campaign
export async function GET(request: Request) {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const campaignId = searchParams.get('campaignId')
    const impersonateId = searchParams.get('impersonate')

    if (!campaignId) {
        return NextResponse.json({ error: 'Campaign ID is required' }, { status: 400 })
    }

    const creds = await resolveCredentials(supabase, impersonateId)
    if (!creds) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    try {
        const supabaseAdmin = getAdminClient()
        const { data, error } = await supabaseAdmin
            .from('campaign_analyses')
            .select('*')
            .eq('campaign_id', campaignId)
            .eq('user_id', creds.targetUserId)
            .order('created_at', { ascending: false })


        if (error) throw error

        return NextResponse.json({ success: true, history: data || [] })
    } catch (e: any) {
        console.error("[GET Campaign Analysis] Error:", e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}

// POST: Run live analysis and save it
export async function POST(request: Request) {
    const supabase = await createClient()
    const { campaignId, impersonateId } = await request.json()

    if (!campaignId) {
        return NextResponse.json({ error: 'Campaign ID is required' }, { status: 400 })
    }

    const creds = await resolveCredentials(supabase, impersonateId)
    if (!creds || !creds.token || !creds.adAccountId) {
        return NextResponse.json({ error: 'Meta Ad Account not fully connected.' }, { status: 400 })
    }

    const supabaseAdmin = getAdminClient()

    try {
        // 1. Fetch Campaign settings, insights, ad sets, and ads in parallel
        const fields = 'id,name,status,daily_budget,lifetime_budget,budget_remaining,insights.date_preset(maximum){spend,impressions,clicks,actions,ctr,cpc,cpm},adsets{id,name,status,daily_budget,lifetime_budget,insights.date_preset(maximum){spend,impressions,clicks,actions},optimization_goal,billing_event,targeting},ads{id,name,status,creative{id,name,object_story_spec},insights.date_preset(maximum){spend,impressions,clicks,actions}}';
        const fbUrl = `${FB_GRAPH_URL}/${campaignId}?fields=${fields}&access_token=${creds.token}`;
        
        const response = await fetch(fbUrl);
        const data = await response.json();

        if (data.error) {
            console.error("Meta Graph API Error during analysis:", data.error);
            return NextResponse.json({ error: data.error.message }, { status: 400 });
        }

        // 2. Parse Campaign Metrics
        const parseInsights = (insightsObj: any) => {
            const insight = insightsObj?.data?.[0];
            if (!insight) return { spend: 0, impressions: 0, clicks: 0, leads: 0, ctr: 0, cpc: 0, cpm: 0, cpl: 0 };
            const spend = parseFloat(insight.spend || '0');
            const impressions = parseInt(insight.impressions || '0', 10);
            const clicks = parseInt(insight.clicks || '0', 10);
            
            const leadAction = insight.actions?.find((a: any) => a.action_type === 'lead');
            const leadGroupedAction = insight.actions?.find((a: any) => a.action_type === 'onsite_conversion.lead_grouped');
            const leads = leadAction ? parseInt(leadAction.value || '0', 10) : (leadGroupedAction ? parseInt(leadGroupedAction.value || '0', 10) : 0);
            
            const ctr = parseFloat(insight.ctr || '0');
            const cpc = parseFloat(insight.cpc || '0');
            const cpm = parseFloat(insight.cpm || '0');
            const cpl = leads > 0 ? spend / leads : 0;
            
            return { spend, impressions, clicks, leads, ctr, cpc, cpm, cpl };
        };

        const metrics = parseInsights(data.insights);

        // 3. Count CRM Leads associated with this campaign (broad match)
        // First try exact campaign_id match
        const { count: crmLeadsExact } = await supabaseAdmin
            .from('leads')
            .select('id', { count: 'exact', head: true })
            .eq('campaign_id', campaignId)
            .eq('user_id', creds.targetUserId);

        // Also count all CRM leads for this user from Facebook sources (some leads may have null campaign_id)
        const { count: crmLeadsTotal } = await supabaseAdmin
            .from('leads')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', creds.targetUserId)
            .in('source', ['Facebook', 'Facebook Ads']);

        const crmLeadsCount = crmLeadsExact || 0;
        const crmLeadsTotalCount = crmLeadsTotal || 0;

        // Determine CRM sync status to provide accurate context to the AI
        let crmSyncStatus = '';
        if (metrics.leads === 0) {
            crmSyncStatus = 'No leads registered by Meta yet.';
        } else if (crmLeadsCount >= metrics.leads) {
            crmSyncStatus = `✅ All ${metrics.leads} Meta leads are synced to the CRM (${crmLeadsCount} matched by campaign). CRM integration is working correctly.`;
        } else if (crmLeadsTotalCount >= metrics.leads) {
            crmSyncStatus = `✅ CRM has ${crmLeadsTotalCount} total Facebook leads for this account (${crmLeadsCount} matched to this specific campaign). Leads are syncing correctly—some may not have the campaign ID tagged but they ARE in the CRM.`;
        } else if (crmLeadsCount > 0) {
            crmSyncStatus = `⚠️ ${crmLeadsCount} of ${metrics.leads} Meta leads matched in CRM for this campaign. ${crmLeadsTotalCount} total Facebook leads exist in CRM. Some recent leads may still be in sync queue.`;
        } else if (crmLeadsTotalCount > 0) {
            crmSyncStatus = `✅ CRM has ${crmLeadsTotalCount} total Facebook leads for this account. These leads are synced but may not have campaign_id tagged. The CRM integration IS working.`;
        } else {
            crmSyncStatus = `⚠️ No Facebook leads found in CRM yet. ${metrics.leads} leads registered by Meta. Check if the webhook integration is active.`;
        }

        // 4. Extract Targeting & Settings details
        const adset = data.adsets?.data?.[0] || {};
        const targeting = adset.targeting || {};
        const locations = targeting.geo_locations || {};
        const age = `${targeting.age_min || 18} - ${targeting.age_max || 65}`;
        const advAudience = targeting.targeting_automation?.advantage_audience === 1 ? 'Enabled' : 'Disabled';

        // 5. Extract Ad creatives copy and media type
        const adsList = (data.ads?.data || []).map((ad: any) => {
            const storySpec = ad.creative?.object_story_spec || {};
            const linkData = storySpec.link_data || {};
            const videoData = storySpec.video_data || {};
            const isVideo = !!videoData.video_id;
            const creativeType = isVideo ? "Video Ad" : "Image/Static Ad";
            const primaryText = linkData.message || videoData.message || '';
            const headline = linkData.name || videoData.title || '';
            return {
                name: ad.name,
                status: ad.status,
                creativeType,
                primaryText,
                headline,
                metrics: parseInsights(ad.insights)
            };
        });

        // 6. Invoke Gemini for Campaign Analysis
        const systemPrompt = `
        You are a Senior Meta Ads Optimization Consultant. Analyze the following Meta campaign performance details for a real estate business.
        
        Campaign Context:
        - Business Name: ${creds.businessName}
        - Campaign Name: ${data.name}
        - Campaign Status: ${data.status}
        - Spend: ${creds.currency === 'INR' ? '₹' : '$'}${metrics.spend.toFixed(2)}
        - Impressions: ${metrics.impressions}
        - Clicks: ${metrics.clicks}
        - CTR: ${metrics.ctr.toFixed(2)}%
        - CPC: ${creds.currency === 'INR' ? '₹' : '$'}${metrics.cpc.toFixed(2)}
        - CPM: ${creds.currency === 'INR' ? '₹' : '$'}${metrics.cpm.toFixed(2)}
        - Leads (Meta API): ${metrics.leads}
        - Leads (CRM - This Campaign): ${crmLeadsCount}
        - Leads (CRM - Total Facebook): ${crmLeadsTotalCount}
        - CRM Sync Status: ${crmSyncStatus}
        - Cost Per Lead (CPL): ${creds.currency === 'INR' ? '₹' : '$'}${metrics.cpl.toFixed(2)}
        - Budget: ${data.daily_budget ? `${creds.currency === 'INR' ? '₹' : '$'}${parseFloat(data.daily_budget)/100}/day` : 'N/A'}
        
        Ad Set Targeting:
        - Age Range: ${age}
        - Locations: ${JSON.stringify(locations)}
        - Advantage+ Audience: ${advAudience}
        - Optimization Goal: ${adset.optimization_goal || 'N/A'}
        - Billing Event: ${adset.billing_event || 'N/A'}
        
        Ad Creatives (${adsList.length} ads):
        ${adsList.map((ad: any, idx: number) => `
        Ad ${idx+1}: "${ad.name}" (Status: ${ad.status}, Type: ${ad.creativeType})
          - Primary Text: "${ad.primaryText}"
          - Headline: "${ad.headline}"
          - Ad Spend: ${creds.currency === 'INR' ? '₹' : '$'}${ad.metrics.spend.toFixed(2)}
          - Ad Impressions: ${ad.metrics.impressions}
          - Ad Clicks: ${ad.metrics.clicks}
          - Ad Leads: ${ad.metrics.leads}
        `).join('\n')}

        
        Based on this information, perform a thorough diagnostic of this campaign.
        - Check run duration (is it extremely new? e.g. launched just days ago).
        - Evaluate budget constraints.
        - Identify delivery bottlenecks (e.g. ad sets holding up budget, imbalance where one ad gets all spend while others get zero).
        - Critique copy and targeting settings (Advantage+ audience, location parameters).
        
        IMPORTANT CRM GUIDANCE: Read the "CRM Sync Status" field carefully. If it says "✅" (checkmark), the CRM integration IS working correctly—do NOT recommend fixing CRM integration or lead sync. Only recommend CRM fixes if the status explicitly says "⚠️" and indicates leads are genuinely missing. Some leads may not have campaign_id tagged but they are still in the CRM database and accessible to the user.
        
        Provide your analysis and clear, actionable steps to improve.
        
        Return your response in STRICT valid JSON format, with keys "analysis_text" and "recommendations":
        {
          "analysis_text": "Provide a complete, detailed paragraph evaluation. Use clear, encouraging, but highly analytical language.",
          "recommendations": [
            {
              "title": "Short title of recommendation (e.g., 'Increase Daily Budget')",
              "description": "Thorough, actionable explanation of how to execute this step and what impact it will have.",
              "priority": "high" | "medium" | "low"
            }
          ]
        }
        Do not add any Markdown formatting or backticks outside the JSON itself. Returning ONLY valid JSON is critical.
        `;

        const aiResponse = await callGemini(systemPrompt);

        // Extract JSON block safely
        let cleanedResponse = aiResponse.trim();
        const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            cleanedResponse = jsonMatch[0];
        }

        const parsedAI = JSON.parse(cleanedResponse);

        // 7. Save Analysis to Database
        const metricsPayload = {
            spend: metrics.spend,
            impressions: metrics.impressions,
            clicks: metrics.clicks,
            leads: metrics.leads,
            crmLeads: crmLeadsCount,
            crmLeadsTotal: crmLeadsTotalCount,
            ctr: metrics.ctr,
            cpc: metrics.cpc,
            cpm: metrics.cpm,
            cpl: metrics.cpl
        };

        const { data: savedAnalysis, error: saveError } = await supabaseAdmin
            .from('campaign_analyses')
            .insert({
                campaign_id: campaignId,
                user_id: creds.targetUserId,
                metrics: metricsPayload,
                analysis_text: parsedAI.analysis_text || "Analysis generated.",
                recommendations: parsedAI.recommendations || []
            })
            .select()
            .single();

        if (saveError) {
            console.error("Database save failed during analysis:", saveError);
            throw saveError;
        }

        return NextResponse.json({
            success: true,
            analysis: savedAnalysis
        });

    } catch (e: any) {
        console.error("[POST Campaign Analysis] Error:", e);
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 });
    }
}
