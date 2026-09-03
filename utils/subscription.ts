export const PLANS = {
    '1 month': {
        name: "1 Month Plan",
        price: 9999,
        limits: {
            videos: 10,
            images: 50,
            seo_articles: 30,
            campaign_launches: 10,
            campaign_optimizations: 10,
            team_members: 5,
            retargeting_campaigns: 0,
            storage_gb: 10
        }
    },
    '6 months': {
        name: "6 Months Plan",
        price: 54999,
        limits: {
            videos: 10,
            images: 50,
            seo_articles: 30,
            campaign_launches: 10,
            campaign_optimizations: 10,
            team_members: 5,
            retargeting_campaigns: 0,
            storage_gb: 10
        }
    },
    '12 months': {
        name: "12 Months Plan",
        price: 99999,
        limits: {
            videos: 10,
            images: 50,
            seo_articles: 30,
            campaign_launches: 10,
            campaign_optimizations: 10,
            team_members: 5,
            retargeting_campaigns: 0,
            storage_gb: 10
        }
    },
    '1-month': {
        name: "1 Month Plan",
        price: 9999,
        limits: {
            videos: 10,
            images: 50,
            seo_articles: 30,
            campaign_launches: 10,
            campaign_optimizations: 10,
            team_members: 5,
            retargeting_campaigns: 0,
            storage_gb: 10
        }
    },
    '6-months': {
        name: "6 Months Plan",
        price: 54999,
        limits: {
            videos: 10,
            images: 50,
            seo_articles: 30,
            campaign_launches: 10,
            campaign_optimizations: 10,
            team_members: 5,
            retargeting_campaigns: 0,
            storage_gb: 10
        }
    },
    '12-months': {
        name: "12 Months Plan",
        price: 99999,
        limits: {
            videos: 10,
            images: 50,
            seo_articles: 30,
            campaign_launches: 10,
            campaign_optimizations: 10,
            team_members: 5,
            retargeting_campaigns: 0,
            storage_gb: 10
        }
    },
    'early bird plan': {
        name: "Pro Plan",
        price: 9999,
        limits: {
            videos: 10,
            images: 50,
            seo_articles: 30,
            campaign_launches: 10,
            campaign_optimizations: 10,
            team_members: 5,
            retargeting_campaigns: 0,
            storage_gb: 10
        }
    },
    growth: {
        name: "Growth Plan",
        price: 9999,
        limits: {
            videos: 5,
            images: 30,
            seo_articles: 30,
            campaign_launches: 5,
            campaign_optimizations: 5,
            team_members: 5,
            retargeting_campaigns: 0,
            storage_gb: 5
        }
    },
    pro: {
        name: "Pro Plan",
        price: 14999,
        limits: {
            videos: 8,
            images: 60,
            seo_articles: 30,
            campaign_launches: 8,
            campaign_optimizations: 8,
            team_members: 10,
            retargeting_campaigns: 0,
            storage_gb: 10
        }
    },
    professional: { // Alias for backwards compatibility
        name: "Pro Plan",
        price: 14999,
        limits: {
            videos: 8,
            images: 60,
            seo_articles: 30,
            campaign_launches: 8,
            campaign_optimizations: 8,
            team_members: 10,
            retargeting_campaigns: 0,
            storage_gb: 10
        }
    },
    enterprise: {
        name: "Enterprise Plan",
        price: 24999,
        limits: {
            videos: 100,
            images: 90,
            seo_articles: 30,
            campaign_launches: 15,
            campaign_optimizations: 15,
            team_members: 20,
            retargeting_campaigns: 0,
            storage_gb: 20
        }
    },
    free: {
        name: "Free Plan",
        price: 0,
        limits: {
            videos: 0,
            images: 5,
            seo_articles: 2,
            campaign_launches: 0,
            campaign_optimizations: 0,
            team_members: 1,
            retargeting_campaigns: 0,
            storage_gb: 1
        }
    }
};

export const ADDONS = {
    video: {
        name: "Additional AI Video",
        price: 999,
        quotaKey: "addon_videos",
        amount: 1,
        label: "+1 AI Video"
    },
    team_member: {
        name: "Additional Team Member",
        price: 299,
        quotaKey: "addon_team_members",
        amount: 1,
        label: "+1 Team Member seat"
    },
    campaign_launch: {
        name: "Additional Campaign Launch",
        price: 399,
        quotaKey: "addon_campaign_launches",
        amount: 1,
        label: "+1 Campaign Launch"
    },
    campaign_optimization: {
        name: "Additional Campaign Optimization",
        price: 249,
        quotaKey: "addon_campaign_optimizations",
        amount: 1,
        label: "+1 Campaign Optimization"
    },
    retargeting_campaign: {
        name: "Additional Retargeting Campaign",
        price: 499,
        quotaKey: "addon_retargeting_campaigns",
        amount: 1,
        label: "+1 Retargeting Campaign"
    },
    image_small: {
        name: "Small Image Pack",
        price: 59,
        quotaKey: "addon_images",
        amount: 10,
        label: "+10 AI Images"
    },
    image_medium: {
        name: "Medium Image Pack",
        price: 199,
        quotaKey: "addon_images",
        amount: 50,
        label: "+50 AI Images"
    },
    image_large: {
        name: "Large Image Pack",
        price: 349,
        quotaKey: "addon_images",
        amount: 100,
        label: "+100 AI Images"
    }
};

// Global fallback object for backward compatibility with existing legacy references
export const PLAN_LIMITS = {
    ai_creatives: 80,
    campaign_launches: 10,
    ai_ad_optimizations: 10,
    remarketing_campaigns: 10,
    seo_articles: 30,
    storage_gb: 10
};

export type UsageStats = {
    ai_creatives_used: number;
    campaign_launches_used: number;
    ai_ad_optimizations_used: number;
    remarketing_campaigns_used: number;
    seo_articles_used: number;
    storage_bytes_used: number;
};

export function getUserLimits(profile: any) {
    const userEmail = (profile?.email || '').toLowerCase().trim();
    const whitelistedEmails = [
        'rchopra489@gmail.com',
        'infobluesquareinfra@gmail.com',
        'khushiramrealtor@gmail.com',
        'meta-reviewer@nobogent.com'
    ];
    const isWhitelisted = whitelistedEmails.includes(userEmail);

    const planKey = (profile?.subscription_plan || 'free').toLowerCase();
    const plan = PLANS[planKey as keyof typeof PLANS] || PLANS.free;
    
    // Base limits from plan
    const base = plan.limits;
    
    // Add purchased add-ons
    const addon_videos = profile?.addon_videos || 0;
    const addon_images = profile?.addon_images || 0;
    const addon_team_members = profile?.addon_team_members || 0;
    const addon_campaign_launches = profile?.addon_campaign_launches || 0;
    const addon_campaign_optimizations = profile?.addon_campaign_optimizations || 0;
    const addon_retargeting_campaigns = profile?.addon_retargeting_campaigns || 0;

    const isKhushiram = userEmail === 'khushiramrealtor@gmail.com' || profile?.business_name?.toLowerCase()?.includes('khushiram');

    const isUnlimitedTeam = (isWhitelisted && !isKhushiram) || 
        profile?.role === 'super_admin' || 
        profile?.role === 'agency' || 
        planKey === 'enterprise' || 
        base.team_members === 999999;

    const teamMemberLimit = isKhushiram 
        ? (3 + addon_team_members) 
        : (isUnlimitedTeam ? 999999 : base.team_members + addon_team_members);

    return {
        videos: isWhitelisted ? 999999 : base.videos + addon_videos,
        images: isWhitelisted ? 999999 : base.images + addon_images,
        seo_articles: isWhitelisted ? 999 : base.seo_articles,
        campaign_launches: isWhitelisted ? 999999 : base.campaign_launches + addon_campaign_launches,
        campaign_optimizations: isWhitelisted ? 999999 : base.campaign_optimizations + addon_campaign_optimizations,
        team_members: teamMemberLimit,
        retargeting_campaigns: isWhitelisted ? 999999 : base.retargeting_campaigns + addon_retargeting_campaigns,
        storage_gb: isWhitelisted ? 999 : base.storage_gb || 10
    };
}
