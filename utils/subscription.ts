export const PLAN_LIMITS = {
    ai_creatives: 80,
    campaign_launches: 10,
    ai_ad_optimizations: 10,
    remarketing_campaigns: 10,
    seo_articles: 30,
    storage_gb: 10
}

export type UsageStats = {
    ai_creatives_used: number;
    campaign_launches_used: number;
    ai_ad_optimizations_used: number;
    remarketing_campaigns_used: number;
    seo_articles_used: number;
    storage_bytes_used: number;
}
