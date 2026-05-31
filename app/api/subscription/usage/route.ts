import { createClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';
import { PLANS, getUserLimits } from '@/utils/subscription';

export async function GET() {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

        if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

        // Resolve Primary User ID (Owner of the limits)
        const primaryUserId = profile.parent_id || user.id;

        // If part of a team, fetch the primary profile for limits and usage reset date
        let primaryProfile = profile;
        if (profile.parent_id) {
            const { data: parentProfile } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', profile.parent_id)
                .single();
            if (parentProfile) primaryProfile = parentProfile;
        }

        // --- CALCULATE STORAGE ---
        const { count: assetCount } = await supabase.from('assets').select('id', { count: 'exact', head: true }).eq('user_id', primaryUserId);
        const { count: propCount } = await supabase.from('properties').select('id', { count: 'exact', head: true }).eq('user_id', primaryUserId);
        const { count: leadCount } = await supabase.from('leads').select('id', { count: 'exact', head: true }).eq('user_id', primaryUserId);
        const { count: msgCount } = await supabase.from('messages').select('id', { count: 'exact', head: true }).eq('user_id', primaryUserId);

        const safeAssetCount = assetCount || 0;
        const safePropCount = propCount || 0;
        const safeLeadCount = leadCount || 0;
        const safeMsgCount = msgCount || 0;

        // DB Estimation: 2KB per row
        const dbBytes = (safePropCount + safeLeadCount + safeAssetCount + safeMsgCount) * 2048;
        
        // Media Estimation: 750KB per asset
        const mediaBytes = safeAssetCount * 750 * 1024;

        const totalBytesUsed = dbBytes + mediaBytes;
        const storageGB = totalBytesUsed / (1024 * 1024 * 1024);
        const storageLimitGB = 10;

        // --- CALCULATE TEAM SIZE ---
        // Fetch added team members linked to this parent ID
        const { count: teamCount } = await supabase
            .from('profiles')
            .select('id', { count: 'exact', head: true })
            .eq('parent_id', primaryUserId)
            .in('role', ['admin', 'agent']);
        const teamUsed = teamCount || 0;

        // Resolve plan-based limits
        const limits = getUserLimits(primaryProfile);

        // Helper to retrieve usage from new column, falling back to legacy column
        const getUsage = (newCol: string, oldCol: string) => {
            if (newCol in primaryProfile && (primaryProfile as any)[newCol] !== null) {
                return (primaryProfile as any)[newCol];
            }
            return (primaryProfile as any)[oldCol] || 0;
        };

        const planKey = (primaryProfile.subscription_plan || 'free').toLowerCase();
        const activePlan = PLANS[planKey as keyof typeof PLANS] || PLANS.free;

        const usageData = {
            planName: activePlan.name,
            resetDate: primaryProfile.usage_reset_date,
            limits: {
                videos: {
                    used: getUsage('videos_used', 'ai_creatives_used'),
                    limit: limits.videos,
                    label: "AI Videos"
                },
                images: {
                    used: getUsage('images_used', 'ai_creatives_used'),
                    limit: limits.images,
                    label: "AI Images"
                },
                seo_articles: {
                    used: primaryProfile.seo_articles_used || 0,
                    limit: limits.seo_articles,
                    label: "SEO Articles"
                },
                campaign_launches: {
                    used: primaryProfile.campaign_launches_used || 0,
                    limit: limits.campaign_launches,
                    label: "Campaign Launches"
                },
                campaign_optimizations: {
                    used: getUsage('campaign_optimizations_used', 'ai_ad_optimizations_used'),
                    limit: limits.campaign_optimizations,
                    label: "Campaign Optimizations"
                },
                retargeting_campaigns: {
                    used: getUsage('retargeting_campaigns_used', 'remarketing_campaigns_used'),
                    limit: limits.retargeting_campaigns,
                    label: "Retargeting Campaigns"
                },
                team_members: {
                    used: teamUsed,
                    limit: limits.team_members,
                    label: "Team Members"
                },
                storage: {
                    used: parseFloat(storageGB.toFixed(4)),
                    limit: storageLimitGB,
                    label: "Cloud Storage (GB)"
                }
            }
        };

        return NextResponse.json(usageData);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
