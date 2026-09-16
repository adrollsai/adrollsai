import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { analyzeCampaignWithDeepSeek } from '@/utils/campaign-analyzer'
import { sendPushNotification } from '@/utils/notification-helper'

const FB_GRAPH_URL = "https://graph.facebook.com/v19.0"

// Admin client to bypass RLS for background cron execution
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: Request) {
    return handleDailyAnalysis(request)
}

export async function POST(request: Request) {
    return handleDailyAnalysis(request)
}

async function handleDailyAnalysis(request: Request) {
    const diagnostics: Record<string, any> = {
        timestamp: new Date().toISOString(),
        profilesProcessed: 0,
        campaignsAnalyzed: 0,
        urgentActionsFound: 0,
        notificationsSent: 0,
        details: [] as any[],
        errors: [] as any[]
    }

    try {
        const url = new URL(request.url)
        const authHeader = request.headers.get('Authorization')
        const cronSecret = url.searchParams.get('cronSecret') || (authHeader ? authHeader.replace('Bearer ', '') : null)
        const specificUserId = url.searchParams.get('userId')
        const specificCampaignId = url.searchParams.get('campaignId')

        // Verify CRON_SECRET if configured and no specific user ID was provided
        if (process.env.CRON_SECRET && cronSecret && cronSecret !== process.env.CRON_SECRET) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // 1. Fetch profiles with connected Meta Ad accounts
        let query = supabaseAdmin
            .from('profiles')
            .select('id, email, business_name, facebook_token, ad_account_id, currency')
            .not('facebook_token', 'is', null)
            .not('ad_account_id', 'is', null)

        if (specificUserId) {
            query = query.eq('id', specificUserId)
        }

        const { data: profiles, error: profileErr } = await query

        if (profileErr || !profiles || profiles.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No profiles with connected Meta ad accounts found.',
                diagnostics
            })
        }

        diagnostics.profilesProcessed = profiles.length

        // 2. Process each profile's active campaigns
        for (const profile of profiles) {
            const profileDiag: any = {
                userId: profile.id,
                businessName: profile.business_name || profile.email,
                campaigns: []
            }

            try {
                // Ensure ad account has 'act_' prefix
                const rawAdAccountId = (profile.ad_account_id || '').trim()
                const formattedAdAccountId = rawAdAccountId.startsWith('act_') ? rawAdAccountId : `act_${rawAdAccountId}`

                let targetCampaigns: { id: string, name: string }[] = []

                if (specificCampaignId) {
                    targetCampaigns = [{ id: specificCampaignId, name: 'Target Campaign' }]
                } else {
                    // Fetch ACTIVE campaigns for this ad account
                    const campaignsUrl = `${FB_GRAPH_URL}/${formattedAdAccountId}/campaigns?effective_status=['ACTIVE']&fields=id,name,status&limit=10&access_token=${profile.facebook_token}`
                    const cRes = await fetch(campaignsUrl)
                    const cData = await cRes.json()

                    if (cData.error) {
                        profileDiag.error = cData.error.message
                        diagnostics.errors.push({ userId: profile.id, error: cData.error.message })
                        diagnostics.details.push(profileDiag)
                        continue
                    }

                    targetCampaigns = cData.data || []
                }

                for (const camp of targetCampaigns) {
                    try {
                        console.log(`[Daily AI Campaign Analysis] Analyzing campaign "${camp.name}" (${camp.id}) for user ${profile.id}...`)
                        const analysisRes = await analyzeCampaignWithDeepSeek({
                            campaignId: camp.id,
                            token: profile.facebook_token,
                            targetUserId: profile.id,
                            businessName: profile.business_name || 'Our Business',
                            currency: profile.currency || 'INR',
                            supabaseAdmin
                        })

                        if (analysisRes.success) {
                            diagnostics.campaignsAnalyzed++
                            const parsedAI = analysisRes.parsedAI || {}
                            const actionItems = parsedAI.action_items || []
                            const urgentItems = actionItems.filter((a: any) => a.priority === 'urgent' || a.priority === 'high' || a.action_type === 'PAUSE_AD')

                            profileDiag.campaigns.push({
                                campaignId: camp.id,
                                campaignName: camp.name,
                                health: parsedAI.overall_health || 'analyzed',
                                actionsCount: actionItems.length,
                                urgentActionsCount: urgentItems.length
                            })

                            if (urgentItems.length > 0) {
                                diagnostics.urgentActionsFound += urgentItems.length

                                // Dispatch an in-app & push notification to the user
                                const topAction = urgentItems[0]
                                const notifTitle = `AI Action: ${topAction.title || 'Campaign Optimization Ready'}`
                                const notifBody = `${topAction.reason || 'DeepSeek AI analyzed your campaign and identified optimizations to save ad budget.'}`

                                await sendPushNotification(
                                    profile.id,
                                    notifTitle,
                                    notifBody,
                                    '/dashboard/ads',
                                    'campaign_analysis'
                                )
                                diagnostics.notificationsSent++
                            }
                        } else {
                            profileDiag.campaigns.push({
                                campaignId: camp.id,
                                error: analysisRes.error
                            })
                            diagnostics.errors.push({ campaignId: camp.id, error: analysisRes.error })
                        }
                    } catch (campErr: any) {
                        console.error(`[Daily AI Campaign Analysis] Error on campaign ${camp.id}:`, campErr)
                        diagnostics.errors.push({ campaignId: camp.id, error: campErr.message })
                    }
                }
            } catch (pErr: any) {
                console.error(`[Daily AI Campaign Analysis] Error processing user ${profile.id}:`, pErr)
                diagnostics.errors.push({ userId: profile.id, error: pErr.message })
            }

            diagnostics.details.push(profileDiag)
        }

        return NextResponse.json({
            success: true,
            message: `Completed daily campaign analysis for ${diagnostics.profilesProcessed} profile(s). Analyzed ${diagnostics.campaignsAnalyzed} campaign(s).`,
            diagnostics
        })

    } catch (e: any) {
        console.error("[Daily AI Campaign Analysis Fatal Error]:", e)
        return NextResponse.json({ error: e.message || 'Fatal cron error' }, { status: 500 })
    }
}
