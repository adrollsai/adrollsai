import { callGemini, callDeepSeekWithUsage } from '@/utils/external-apis'

const FB_GRAPH_URL = "https://graph.facebook.com/v19.0"

export interface CampaignAnalysisResult {
    success: boolean
    analysis?: any
    parsedAI?: any
    metrics?: any
    error?: string
}

export interface RunAnalysisOptions {
    campaignId: string
    token: string
    targetUserId: string
    businessName?: string
    currency?: string
    supabaseAdmin: any
}

export async function analyzeCampaignWithDeepSeek({
    campaignId,
    token,
    targetUserId,
    businessName = 'Our Business',
    currency = 'INR',
    supabaseAdmin
}: RunAnalysisOptions): Promise<CampaignAnalysisResult> {
    try {
        // 1. Fetch comprehensive Campaign settings, insights, ad sets, and ads from Meta Graph API
        const fields = 'id,name,status,daily_budget,lifetime_budget,budget_remaining,insights.date_preset(maximum){spend,impressions,reach,clicks,actions,cost_per_action_type,ctr,cpc,cpm,inline_link_clicks,inline_link_click_ctr,cost_per_inline_link_click},adsets{id,name,status,daily_budget,lifetime_budget,insights.date_preset(maximum){spend,impressions,reach,clicks,actions,ctr,cpc,cpm},optimization_goal,billing_event,targeting,promoted_object,destination_type},ads{id,name,status,creative{id,name,object_story_spec},insights.date_preset(maximum){spend,impressions,reach,clicks,actions,cost_per_action_type,ctr,cpc,cpm,inline_link_clicks,inline_link_click_ctr,cost_per_inline_link_click}}'
        const fbUrl = `${FB_GRAPH_URL}/${campaignId}?fields=${fields}&access_token=${token}`

        const response = await fetch(fbUrl)
        const data = await response.json()

        if (data.error) {
            console.error(`[Campaign Analyzer] Meta Graph API Error for campaign ${campaignId}:`, data.error)
            return { success: false, error: data.error.message }
        }

        // 2. Identify destination & parse metrics (handling both standard Lead Forms & WhatsApp Campaigns)
        const adset = data.adsets?.data?.[0] || {}
        const isWhatsAppCampaign = adset.destination_type === 'WHATSAPP' || 
                                   adset.optimization_goal === 'CONVERSATIONS' ||
                                   (data.name || '').toLowerCase().includes('whatsapp')

        const parseInsights = (insightsObj: any, isWhatsApp: boolean = false) => {
            const insight = insightsObj?.data?.[0]
            if (!insight) return { 
                spend: 0, impressions: 0, reach: 0, frequency: 1, clicks: 0, inline_link_clicks: 0,
                leads: 0, messaging_conversations: 0, ctr: 0, link_click_ctr: 0, cpc: 0, cost_per_link_click: 0, cpm: 0, cpl: 0 
            }
            const spend = parseFloat(insight.spend || '0')
            const impressions = parseInt(insight.impressions || '0', 10)
            const reach = parseInt(insight.reach || '0', 10)
            const frequency = parseFloat(insight.frequency || '1')
            const clicks = parseInt(insight.clicks || '0', 10)
            const inline_link_clicks = parseInt(insight.inline_link_clicks || '0', 10)
            
            // Check standard lead actions
            const leadAction = insight.actions?.find((a: any) => a.action_type === 'lead')
            const leadGroupedAction = insight.actions?.find((a: any) => a.action_type === 'onsite_conversion.lead_grouped')
            const standardLeads = leadAction ? parseInt(leadAction.value || '0', 10) : (leadGroupedAction ? parseInt(leadGroupedAction.value || '0', 10) : 0)
            
            // Check messaging conversation actions (WhatsApp / Messenger)
            const msgConvoAction = insight.actions?.find((a: any) => 
                a.action_type === 'onsite_conversion.messaging_conversation_started_7d' ||
                a.action_type === 'onsite_conversion.total_messaging_connection' ||
                a.action_type === 'onsite_conversion.messaging_first_reply'
            )
            const messagingConversations = msgConvoAction ? parseInt(msgConvoAction.value || '0', 10) : 0
            
            // If WhatsApp campaign or messaging actions exist, primary results are messaging conversations
            const leads = (isWhatsApp || messagingConversations > 0) ? (messagingConversations || standardLeads) : standardLeads
            
            const ctr = parseFloat(insight.ctr || '0')
            const link_click_ctr = parseFloat(insight.inline_link_click_ctr || '0')
            const cpc = parseFloat(insight.cpc || '0')
            const cost_per_link_click = parseFloat(insight.cost_per_inline_link_click || '0')
            const cpm = parseFloat(insight.cpm || '0')
            const cpl = leads > 0 ? spend / leads : 0
            
            return { 
                spend, impressions, reach, frequency, clicks, inline_link_clicks,
                leads, messaging_conversations: messagingConversations,
                ctr, link_click_ctr, cpc, cost_per_link_click, cpm, cpl 
            }
        }

        const metrics = parseInsights(data.insights, isWhatsAppCampaign)

        // 3. Count CRM Leads associated with this campaign
        const { count: crmLeadsExact } = await supabaseAdmin
            .from('leads')
            .select('id', { count: 'exact', head: true })
            .eq('campaign_id', campaignId)
            .eq('user_id', targetUserId)

        const { count: crmLeadsTotal } = await supabaseAdmin
            .from('leads')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', targetUserId)
            .or('source.ilike.%facebook%,source.ilike.%whatsapp%')

        const crmLeadsCount = crmLeadsExact || 0
        const crmLeadsTotalCount = crmLeadsTotal || 0

        let crmSyncStatus = ''
        if (metrics.leads === 0) {
            crmSyncStatus = 'No results registered by Meta yet.'
        } else if (crmLeadsCount >= metrics.leads) {
            crmSyncStatus = `✅ All ${metrics.leads} Meta results are synced to the CRM (${crmLeadsCount} matched to campaign). Integration is working smoothly.`
        } else if (crmLeadsCount > 0) {
            crmSyncStatus = `✅ CRM has ${crmLeadsCount} leads attributed to this campaign (${crmLeadsTotalCount} total leads). Sync is active.`
        } else {
            crmSyncStatus = `⚠️ ${metrics.leads} results recorded by Meta, but 0 currently tagged with this campaign ID in CRM. (Note: For Click-to-WhatsApp ads, Meta counts when WhatsApp is opened, while CRM logs when the user presses Send).`
        }

        // 4. Extract Targeting & Settings details
        const targeting = adset.targeting || {}
        const locations = targeting.geo_locations || {}
        const age = `${targeting.age_min || 18} - ${targeting.age_max || 65}`
        const advAudience = targeting.targeting_automation?.advantage_audience === 1 ? 'Enabled' : 'Disabled'

        // 5. Extract Ad creatives copy, media type, and granular metrics
        const adsList = (data.ads?.data || []).map((ad: any) => {
            const storySpec = ad.creative?.object_story_spec || {}
            const linkData = storySpec.link_data || {}
            const videoData = storySpec.video_data || {}
            const isVideo = !!videoData.video_id
            const creativeType = isVideo ? "Video Ad" : "Image/Static Ad"
            const primaryText = linkData.message || videoData.message || ''
            const headline = linkData.name || videoData.title || ''
            const linkUrl = linkData.link || ''
            const adMetrics = parseInsights(ad.insights, isWhatsAppCampaign)

            return {
                id: ad.id,
                name: ad.name,
                status: ad.status,
                creativeType,
                primaryText,
                headline,
                linkUrl,
                metrics: adMetrics
            }
        })

        // 6. Invoke DeepSeek Flash (with Gemini fallback) for Campaign Diagnostics
        const systemPrompt = `
You are an elite Meta Ads Performance Director and Media Buyer specializing in Real Estate. Analyze the following Meta campaign performance details and generate ultra-actionable, easy-to-understand next steps for the business owner.

Campaign Details:
- Business: ${businessName}
- Campaign Name: ${data.name} (Status: ${data.status})
- Campaign Type: ${isWhatsAppCampaign ? 'Click-to-WhatsApp (Meta Native Greeting / Conversations)' : 'Instant Lead Form / Web'}
- Total Spend: ${currency === 'INR' ? '₹' : '$'}${metrics.spend.toFixed(2)}
- Impressions: ${metrics.impressions} (Reach: ${metrics.reach}, Frequency: ${metrics.frequency.toFixed(2)})
- Total Clicks: ${metrics.clicks} (Link Clicks: ${metrics.inline_link_clicks})
- Overall CTR: ${metrics.ctr.toFixed(2)}% (Link Click CTR: ${metrics.link_click_ctr.toFixed(2)}%)
- Overall CPC: ${currency === 'INR' ? '₹' : '$'}${metrics.cpc.toFixed(2)} (Link CPC: ${currency === 'INR' ? '₹' : '$'}${metrics.cost_per_link_click.toFixed(2)})
- CPM: ${currency === 'INR' ? '₹' : '$'}${metrics.cpm.toFixed(2)}
- Meta Results: ${metrics.leads} ${isWhatsAppCampaign ? 'Messaging Conversations' : 'Leads'}
- Cost Per Result: ${currency === 'INR' ? '₹' : '$'}${metrics.cpl.toFixed(2)}
- Daily Budget: ${data.daily_budget ? `${currency === 'INR' ? '₹' : '$'}${parseFloat(data.daily_budget)/100}/day` : 'N/A'}
- CRM Integration Status: ${crmSyncStatus}

Ad Set Targeting:
- Age Range: ${age}
- Target Locations: ${JSON.stringify(locations)}
- Advantage+ Audience: ${advAudience}
- Optimization Goal: ${adset.optimization_goal || 'N/A'}

Individual Ad Creatives Breakdown (${adsList.length} ads):
${adsList.map((ad: any, idx: number) => `
Ad #${idx+1}: "${ad.name}" (ID: "${ad.id}", Status: ${ad.status}, Type: ${ad.creativeType})
  - Headline: "${ad.headline}"
  - Primary Copy: "${ad.primaryText.slice(0, 160)}..."
  - Spend: ${currency === 'INR' ? '₹' : '$'}${ad.metrics.spend.toFixed(2)} (${metrics.spend > 0 ? ((ad.metrics.spend / metrics.spend) * 100).toFixed(0) : 0}% of campaign budget)
  - Impressions: ${ad.metrics.impressions}
  - Clicks: ${ad.metrics.clicks} (Link Clicks: ${ad.metrics.inline_link_clicks})
  - CTR: ${ad.metrics.ctr.toFixed(2)}% | Link CTR: ${ad.metrics.link_click_ctr.toFixed(2)}%
  - CPC: ${currency === 'INR' ? '₹' : '$'}${ad.metrics.cpc.toFixed(2)}
  - Results (${isWhatsAppCampaign ? 'Conversations' : 'Leads'}): ${ad.metrics.leads}
  - Cost Per Result: ${currency === 'INR' ? '₹' : '$'}${ad.metrics.cpl.toFixed(2)}
`).join('\n')}

DIAGNOSTIC GUIDELINES:
1. Learning Phase & Spend Reality: If total spend is under ₹500 or running for <48 hours, reassure the user that traffic costs (CPC/CPM) determine early viability, not premature cost-per-lead panic.
2. Winner Identification: Pinpoint the ad with highest CTR and lowest CPC (e.g. CTR > 2%, CPC < ₹8). Label it as the winner.
3. Budget Drain Identification: Spot any ad that has eaten >30% of spend with high CPC (>₹12) and low CTR (<1%) without delivering efficient results. EXPLICITLY recommend pausing it!
4. Creative Angle & Copy Insights: Compare copy angles. Contrast high-CTR hooks (e.g. immediate value, pricing, ready-to-move, bank loan) against weak angles (e.g. dense layout descriptions), and advise exactly what new creative variations to produce next.
5. Tone: High-energy, elite marketing strategist, direct, practical, in plain layman's terms without confusing jargon.

Respond in STRICT, VALID JSON ONLY (no markdown fences, no code blocks):
{
  "verdict_summary": "2-3 crisp sentences providing the bottom line verdict on how the campaign is doing right now and the main opportunity.",
  "overall_health": "healthy" | "needs_attention" | "critical",
  "creative_breakdown": [
    {
      "id": "exact ad id",
      "name": "exact ad name",
      "badge": "winner" | "drain" | "stable" | "testing",
      "badge_label": "e.g. 🔥 Top Performer or ⚠️ Budget Drain or ⏳ Low Spend",
      "verdict": "1 concise sentence explaining this creative's performance and status.",
      "ctr": 0.0,
      "cpc": 0.0,
      "spend": 0.0,
      "leads": 0
    }
  ],
  "action_items": [
    {
      "id": "unique-id",
      "action_type": "PAUSE_AD" | "BOOST_AD" | "BUDGET" | "NEW_CREATIVE" | "CREATIVE_ANGLE",
      "priority": "urgent" | "high" | "medium" | "low",
      "target_ad_id": "exact ad id if action applies to a specific ad, else null",
      "target_ad_name": "exact ad name if applicable, else null",
      "title": "Clear action title (e.g. 'Pause High-Cost Ad: DR_WardhaRoad_3AcreLayout')",
      "reason": "Plain-English explanation with exact numbers showing why to do this (e.g. 'This ad charges ₹14.88 per click with low 0.76% CTR, eating 38% of your daily budget').",
      "instruction": "Step-by-step what the user should do right now.",
      "expected_impact": "Financial impact (e.g. 'Immediately frees up ₹90/day to funnel into your ₹2.56/click winner')."
    }
  ]
}
`

        let parsedAI: any = null
        try {
            console.log(`[Campaign Analyzer] Calling DeepSeek Flash for campaign ${campaignId}...`)
            const dsResult = await callDeepSeekWithUsage(systemPrompt)
            let cleaned = dsResult.text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
            if (jsonMatch) cleaned = jsonMatch[0]
            parsedAI = JSON.parse(cleaned)
        } catch (dsErr: any) {
            console.warn('[Campaign Analyzer] DeepSeek call failed/timed out, falling back to Gemini:', dsErr?.message)
            const geminiRes = await callGemini(systemPrompt)
            let cleaned = geminiRes.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
            if (jsonMatch) cleaned = jsonMatch[0]
            parsedAI = JSON.parse(cleaned)
        }

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
            cpl: metrics.cpl,
            isWhatsApp: isWhatsAppCampaign,
            overallHealth: parsedAI?.overall_health || 'needs_attention',
            creativeBreakdown: parsedAI?.creative_breakdown || []
        }

        const { data: savedAnalysis, error: saveError } = await supabaseAdmin
            .from('campaign_analyses')
            .insert({
                campaign_id: campaignId,
                user_id: targetUserId,
                metrics: metricsPayload,
                analysis_text: parsedAI?.verdict_summary || "Analysis generated.",
                recommendations: parsedAI?.action_items || parsedAI?.recommendations || []
            })
            .select()
            .single()

        if (saveError) {
            console.error("[Campaign Analyzer] Database save failed:", saveError)
            throw saveError
        }

        return {
            success: true,
            analysis: savedAnalysis,
            parsedAI,
            metrics: metricsPayload
        }

    } catch (e: any) {
        console.error(`[Campaign Analyzer] Error for campaign ${campaignId}:`, e)
        return { success: false, error: e.message || 'Internal Server Error' }
    }
}
