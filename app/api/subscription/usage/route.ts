import { createClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';
import { PLAN_LIMITS } from '@/utils/subscription';

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
        
        // Media Estimation: 750KB per asset (average for high-res ad creatives)
        const mediaBytes = safeAssetCount * 750 * 1024;

        const totalBytesUsed = dbBytes + mediaBytes;
        const storageGB = totalBytesUsed / (1024 * 1024 * 1024);
        const storageLimitGB = 10; // Early Bird Plan Limit

        const usageData = {
            planName: "Early Bird Plan",
            resetDate: primaryProfile.usage_reset_date,
            limits: {
                ai_creatives: {
                    used: primaryProfile.ai_creatives_used || 0,
                    limit: PLAN_LIMITS.ai_creatives,
                    label: "AI Creatives"
                },
                campaign_launches: {
                    used: primaryProfile.campaign_launches_used || 0,
                    limit: PLAN_LIMITS.campaign_launches,
                    label: "Campaign Launches"
                },
                ai_ad_optimizations: {
                    used: primaryProfile.ai_ad_optimizations_used || 0,
                    limit: PLAN_LIMITS.ai_ad_optimizations,
                    label: "AI Optimizations"
                },
                remarketing_campaigns: {
                    used: primaryProfile.remarketing_campaigns_used || 0,
                    limit: PLAN_LIMITS.remarketing_campaigns,
                    label: "Remarketing Campaigns"
                },
                seo_articles: {
                    used: primaryProfile.seo_articles_used || 0,
                    limit: PLAN_LIMITS.seo_articles,
                    label: "SEO Articles"
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
